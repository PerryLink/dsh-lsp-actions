/**
 * The editor-protocol service: the transport-agnostic `lsp.actions.list` / `lsp.actions.run` /
 * `lsp.events` surface editors consume. It owns the action dispatch, the per-run timeout, the
 * version check, the bounded diagnostics cache (invalidated by filesystem observations and by the
 * plugin's own writes), and the event stream; the JSON-RPC transport in `server.ts` is one thin
 * consumer of it. Everything the service registers (listeners, cache, event subscriptions) is
 * effect-scoped through the plugin's `ctx.effect`, so stopping the plugin reverses it all.
 * @module dsh-lsp-actions/editor/service
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ActionRunner } from '../runner.ts'
import type { FormatSandboxController } from '../sandbox.ts'
import type { ResolvedConfig } from '../servers.ts'
import { LspActionError } from '../vocabulary.ts'
import { EDITOR_ACTIONS, runEditorAction } from './actions.ts'
import type { EditorRunContext } from './actions.ts'
import { LruDiagnosticsCache } from './cache.ts'
import { EDITOR_PROTOCOL } from './types.ts'
import type { EditorEvent, EditorListResult, EditorRunRequest, EditorRunResult, EditorSessionInfo } from './types.ts'

/** The sessions service's minimal structural shape (optional capability). */
interface SessionsService {
  list(): readonly { id: unknown; header: { cwd?: string } }[]
}

/** The agents service's minimal structural shape (optional capability). */
interface AgentsService {
  get(id: unknown): { session: { id: unknown } } | undefined
}

/** The listener contract of the event stream. */
export type EditorEventListener = (event: EditorEvent) => void

/**
 * The editor action surface for one plugin instance. Construction registers nothing; call
 * {@link EditorActionService.start} (inside the plugin's effect) to attach listeners.
 */
export class EditorActionService {
  private readonly listeners = new Set<EditorEventListener>()
  private started = false
  /** Serial source for request ids of runs that did not supply one (instance-owned, so a plugin reload never shares it). */
  private serial = 0

  constructor(
    private readonly ctx: Context,
    private readonly runner: ActionRunner,
    private readonly sandbox: FormatSandboxController,
    private readonly config: ResolvedConfig,
    private readonly cache: LruDiagnosticsCache,
  ) {}

  /**
   * Attach the reversible listeners: filesystem observations invalidate cached diagnostics (and
   * announce `file.changed`), and session creation/disposal re-announce the session list. Safe to
   * call once; the returned disposer detaches everything.
   * @returns the disposal function for this service's listeners.
   */
  start(): () => void {
    if (this.started) throw new Error('lsp-actions editor service already started')
    this.started = true
    const offObserved = this.ctx.on('fs/observed', (...args: unknown[]) => {
      const target = args[0] as { displayPath?: string; targetKey?: string } | undefined
      const observation = args[1] as { kind?: string } | undefined
      if (target === undefined || observation?.kind !== 'present') return
      const key = target.displayPath ?? target.targetKey
      if (key === undefined) return
      if (this.cache.delete(key)) this.announce({ kind: 'file.changed', filePath: key })
    })
    const announceSessions = (): void => {
      this.announce({ kind: 'sessions.changed', sessions: this.sessionSnapshot() })
    }
    const sessions = this.sessionsService()
    const offCreated = sessions === undefined ? undefined : this.ctx.on('session/created', () => { announceSessions() })
    const offDisposed = sessions === undefined ? undefined : this.ctx.on('session/disposed', () => { announceSessions() })
    return () => {
      offObserved()
      offCreated?.()
      offDisposed?.()
      this.listeners.clear()
      this.cache.clear()
      this.started = false
    }
  }

  /**
   * The `lsp.actions.list` result: the protocol identity, the v1 action catalog, and the
   * addressable DSH sessions (live sessions from the optional `sessions` service).
   * @returns the list payload.
   */
  list(): EditorListResult {
    return {
      protocol: EDITOR_PROTOCOL,
      version: 1,
      actions: EDITOR_ACTIONS,
      sessions: this.sessionSnapshot(),
    }
  }

  /**
   * Run one editor action: version-check, validate, bind the addressed session's live agent (for
   * the official permission-preset and approval choreography), enforce the configured per-run
   * timeout, emit `action.status` lifecycle events, and always answer with the structured success
   * or failure envelope.
   * @param request - the raw `lsp.actions.run` parameters.
   * @param signal - optional caller cancellation, raced with the configured timeout.
   * @returns the unified run envelope.
   */
  async run(request: EditorRunRequest, signal?: AbortSignal): Promise<EditorRunResult> {
    const requestId = typeof request?.requestId === 'string' && request.requestId !== '' ? request.requestId : `editor-${this.counter()}`
    // Every failure — including protocol-level validation — answers through the same structured
    // envelope, so clients route on `status`/`error.code` and never parse JSON-RPC error text.
    const refused = (code: string, message: string): EditorRunResult => {
      const error = { code, message }
      if (typeof request?.action === 'string' && request.action !== '') {
        this.announce({ kind: 'action.status', requestId, action: request.action, status: 'failed', error })
      }
      return { requestId, action: typeof request?.action === 'string' ? request.action : '', status: 'failed', error }
    }
    if (request?.protocol !== undefined && request.protocol !== EDITOR_PROTOCOL) {
      return refused('LSP_PROTOCOL_VERSION_UNSUPPORTED', `unsupported editor protocol "${String(request.protocol)}" — this server speaks ${EDITOR_PROTOCOL}`)
    }
    if (typeof request?.action !== 'string' || request.action.trim() === '') {
      return refused('LSP_ACTION_INVALID_ARGS', 'lsp.actions.run requires a non-empty string action')
    }
    const action = request.action
    const agent = this.liveAgentOf(request.sessionId)
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(new LspActionError(`the editor action timed out after ${this.config.editor.requestTimeoutMs} ms`, 'LSP_ACTION_UNAVAILABLE')) }, this.config.editor.requestTimeoutMs)
    const run: EditorRunContext = {
      requestId,
      signal: signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]),
      agent,
    }
    this.announce({ kind: 'action.status', requestId, action, status: 'started' })
    try {
      const result = await runEditorAction(
        { ctx: this.ctx, runner: this.runner, sandbox: this.sandbox, config: this.config, cache: this.cache, onEvent: event => this.announce(event) },
        action,
        request.params === null || typeof request.params !== 'object' ? undefined : request.params as Record<string, unknown>,
        run,
      )
      this.announce({ kind: 'action.status', requestId, action, status: 'succeeded' })
      return { requestId, action, status: 'succeeded', result }
    } catch (error) {
      const info = structuredError(error)
      this.announce({ kind: 'action.status', requestId, action, status: 'failed', error: info })
      return { requestId, action, status: 'failed', error: info }
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Subscribe to the event stream. Returns a disposer for the subscription. */
  subscribe(listener: EditorEventListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The current live-session snapshot. */
  private sessionSnapshot(): EditorSessionInfo[] {
    const sessions = this.sessionsService()
    if (sessions === undefined) return []
    const agents = this.ctx.get('agents') as AgentsService | undefined
    return sessions.list().map(session => ({
      sessionId: String(session.id),
      cwd: session.header.cwd ?? '',
      live: agents?.get(session.id) !== undefined,
    }))
  }

  /** The live agent of the addressed session, when one exists. */
  private liveAgentOf(sessionId: string | undefined): { session: { id: unknown } } | undefined {
    if (sessionId === undefined) return undefined
    const sessions = this.sessionsService()
    if (sessions === undefined) return undefined
    const session = sessions.list().find(candidate => String(candidate.id) === sessionId)
    if (session === undefined) return undefined
    const agents = this.ctx.get('agents') as AgentsService | undefined
    return agents?.get(session.id)
  }

  private sessionsService(): SessionsService | undefined {
    return this.ctx.get('sessions') as SessionsService | undefined
  }

  private announce(event: EditorEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  /** A per-service-instance unique request id for runs that did not supply one. */
  private counter(): string {
    this.serial += 1
    return `editor-${this.serial}`
  }
}

/** Map one thrown failure to the stable, plain-JSON error shape of a failed envelope. */
function structuredError(error: unknown): { code: string; message: string } {
  if (error instanceof LspActionError) return { code: error.code, message: error.message }
  return { code: 'LSP_ACTION_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) }
}
