/**
 * The plugin's own minimal LSP action client — the fallback for compositions where the official
 * `ctx.lsp` seam does not serve action operations yet. One server process per (server entry,
 * canonical workspace), lazily spawned and serialized; each action runs the transient
 * didOpen→request→didClose lifecycle the servers expect, and teardown is bounded. See
 * `docs/seam-extension-notes.md` for the migration story to the official seam.
 * @module dsh-lsp-actions/client
 */

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { Context } from '@deepseek-ai/cordis'
import { abortable } from './abort.ts'
import { LspConnection } from './connection.ts'
import type { ConnectionSpawner } from './connection.ts'
import { canonicalizeWorkspace } from './host.ts'
import type { HostSource, HostWorkspace } from './host.ts'
import {
  negotiatePositionEncoding,
  normalizeCompletionItems,
  normalizeDiagnostics,
  normalizeEdits,
  requestMethod,
  supportsAction,
  supportsPullDiagnostics,
  supportsTransientOpen,
} from './translate.ts'
import type { WireServerCapabilities } from './translate.ts'
import type { LspActionResult, LspCompletionResult, LspDiagnostic, LspDiagnosticsResult, LspEditsResult, LspPosition, LspRange } from './vocabulary.ts'
import { LspActionError } from './vocabulary.ts'
import type { ResolvedServer } from './servers.ts'

/** One action call as the client receives it: everything the tool already knows. */
export interface ActionRequest {
  /** The source file (relative to `workspaceRoot` or absolute). */
  readonly filePath: string
  /** The workspace root the client resolves against and indexes. */
  readonly workspaceRoot: string
  /** The pre-read, byte-capped source the didOpen synchronizes with the server. */
  readonly source: HostSource
  /** The LSP language id for `filePath`, from the routed server's extension mapping. */
  readonly languageId: string
  /** The cursor position, for completion. */
  readonly position?: LspPosition
  /** The formatting range, for range formatting. */
  readonly range?: LspRange
}

/** Everything one instance needs beyond the connection spec. */
interface InstanceSpec {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly workspaceUri: string
  readonly env: Record<string, string>
  readonly configuration: unknown
  readonly initializationOptions: unknown
  readonly formattingOptions: unknown
  readonly maxMessageBytes: number
  readonly maxStderrBytes: number
  readonly killGraceMs: number
  readonly shutdownTimeoutMs: number
  readonly diagnosticsSettleMs: number
}

/**
 * Pooled minimal LSP action client. Instances are single-flight per canonical workspace and are
 * evicted as soon as they die; every await observes cancellation.
 */
export class LspActionClient {
  private readonly instances = new Map<string, LspActionInstance>()
  private readonly lifetime = new AbortController()
  private disposed = false

  constructor(
    private readonly subprocess: Context['subprocess'],
    private readonly fs: FileSystem,
  ) {}

  /** Spawn one connection through the subprocess seam (the real provider at runtime). */
  private readonly spawner: ConnectionSpawner = spec => this.subprocess.spawn(spec)

  /**
   * Run the diagnostics action through the routed server.
   * @param server - the routed server entry.
   * @param request - the action request.
   * @param signal - optional cancellation.
   * @returns the normalized diagnostics result.
   */
  diagnostics(server: ResolvedServer, request: ActionRequest, signal?: AbortSignal): Promise<LspDiagnosticsResult> {
    return this.run(server, request, signal, instance => instance.diagnostics(request, signal))
  }

  /**
   * Run the formatting action through the routed server; the client only RETURNS edits, it never
   * writes files — the tool applies them through `ctx.fs` write-intent.
   * @param server - the routed server entry.
   * @param request - the action request (carries the optional range).
   * @param signal - optional cancellation.
   * @returns the normalized edits result.
   */
  formatDocument(server: ResolvedServer, request: ActionRequest, signal?: AbortSignal): Promise<LspEditsResult> {
    return this.run(server, request, signal, instance => instance.formatDocument(request, signal))
  }

  /**
   * Run the completion action through the routed server.
   * @param server - the routed server entry.
   * @param request - the action request (carries the cursor position).
   * @param signal - optional cancellation.
   * @returns the normalized completion result.
   */
  completion(server: ResolvedServer, request: ActionRequest, signal?: AbortSignal): Promise<LspCompletionResult> {
    return this.run(server, request, signal, instance => instance.completion(request, signal))
  }

  /** Disposed flag through a method so an await cannot narrow it to a literal. */
  private isDisposed(): boolean {
    return this.disposed
  }

  /** Reject work that cannot publish or use a client-owned instance. */
  private assertActive(signal?: AbortSignal): void {
    if (this.isDisposed()) throw new LspActionError('LSP action client is disposed', 'LSP_ACTION_SERVER_FAILED')
    if (signal?.aborted) throw signal.reason
  }

  /** Fuse caller cancellation with client disposal for every filesystem and protocol await. */
  private querySignal(signal?: AbortSignal): AbortSignal {
    return signal === undefined
      ? this.lifetime.signal
      : AbortSignal.any([signal, this.lifetime.signal])
  }

  private async run<T>(
    server: ResolvedServer,
    request: ActionRequest,
    signal: AbortSignal | undefined,
    body: (instance: LspActionInstance, signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    this.assertActive(signal)
    const querySignal = this.querySignal(signal)
    const workspace = await canonicalizeWorkspace(this.fs, request.workspaceRoot, querySignal)
    this.assertActive(querySignal)
    const key = `${server.serverId}\u0000${workspace.target.targetKey}`
    return this.enqueue(key, querySignal, async () => {
      this.assertActive(querySignal)
      const instance = this.instanceFor(key, workspace, server)
      try {
        return await body(instance, querySignal)
      } finally {
        // A dead instance can never serve again: evict it so the next call spawns fresh.
        if (instance.dead) {
          await instance.dispose().catch(() => {})
          if (this.instances.get(key) === instance) this.instances.delete(key)
        }
      }
    })
  }

  /** Serialize one complete action lifecycle per canonical workspace. */
  private enqueue<T>(key: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    const previous = this.tailFor(key)
    const result = abortable(previous, signal).then(run)
    // The tail follows the actual prior work even when this caller aborts its wait, so later
    // callers still serialize without inheriting an earlier action's outcome.
    this.setTail(key, previous.then(() => result).then(() => undefined, () => undefined))
    return result
  }

  /** The serialization tail for one workspace key (per-instance queues live on the instance). */
  private tails = new Map<string, Promise<void>>()
  private tailFor(key: string): Promise<void> {
    return this.tails.get(key) ?? Promise.resolve()
  }
  private setTail(key: string, tail: Promise<void>): void {
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
  }

  /** Return or synchronously publish the one instance for a canonical workspace. */
  private instanceFor(key: string, workspace: HostWorkspace, server: ResolvedServer): LspActionInstance {
    this.assertActive()
    const existing = this.instances.get(key)
    if (existing !== undefined) return existing
    const created = new LspActionInstance({
      executable: server.executable,
      args: server.entry.args,
      cwd: workspace.canonicalPath,
      workspaceUri: workspace.fileUrl,
      env: server.entry.env,
      configuration: server.entry.configuration,
      initializationOptions: server.entry.initializationOptions,
      formattingOptions: server.entry.formattingOptions,
      maxMessageBytes: server.entry.maxMessageBytes,
      maxStderrBytes: server.entry.maxStderrBytes,
      killGraceMs: server.entry.killGraceMs,
      shutdownTimeoutMs: server.entry.shutdownTimeoutMs,
      diagnosticsSettleMs: server.entry.diagnosticsSettleMs,
    }, this.spawner)
    this.instances.set(key, created)
    return created
  }

  /** Dispose every live instance and block further actions. */
  async disposeAll(): Promise<void> {
    this.disposed = true
    this.lifetime.abort(new LspActionError('LSP action client is disposed', 'LSP_ACTION_SERVER_FAILED'))
    const live = [...this.instances.values()]
    this.instances.clear()
    const results = await Promise.allSettled(live.map(instance => instance.dispose()))
    const failures: unknown[] = []
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'lsp-actions instance teardown failed')
  }
}

/** One initialized server process: handshake, serialized queue, and bounded teardown. */
class LspActionInstance {
  private readonly connection: LspConnection
  private capabilities: WireServerCapabilities | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  private teardownPromise: Promise<void> | undefined
  private processClosed = false
  private readonly ready: Promise<void>
  /** Latest pushed diagnostic batch per document URI (push-only servers). */
  private readonly pushed = new Map<string, LspDiagnostic[]>()
  private readonly pushWaiters = new Map<string, () => void>()

  constructor(private readonly spec: InstanceSpec, spawner: ConnectionSpawner) {
    this.connection = new LspConnection({
      command: spec.executable,
      args: spec.args,
      cwd: spec.cwd,
      env: spec.env,
      maxMessageBytes: spec.maxMessageBytes,
      maxStderrBytes: spec.maxStderrBytes,
      killGraceMs: spec.killGraceMs,
      configuration: spec.configuration,
    }, spawner, (method, params) => this.answerServerRequest(method, params))
    this.connection.onNotification((method, params) => { this.onNotification(method, params) })
    this.ready = this.initialize()
    // A handshake rejection must not surface as an unhandled rejection before the first action
    // awaits it; actions attach the real handler.
    this.ready.catch(() => {})
    void this.connection.closed.then(() => { this.processClosed = true })
  }

  /** Synchronous liveness check: true once the process closed or the instance was disposed. */
  get dead(): boolean {
    return this.processClosed || this.disposed || this.connection.failed
  }

  private async initialize(): Promise<void> {
    try {
      const result = await this.connection.request('initialize', {
        // A subprocess provider may run in another PID namespace or machine;
        // the host PID would let the server monitor an unrelated process.
        processId: null,
        rootUri: this.spec.workspaceUri,
        workspaceFolders: [{ uri: this.spec.workspaceUri, name: 'workspace' }],
        capabilities: CLIENT_CAPABILITIES,
        initializationOptions: this.spec.initializationOptions,
      })
      const capabilities = (result as { capabilities?: unknown }).capabilities
      if (capabilities === null || typeof capabilities !== 'object') {
        throw new LspActionError('language server initialize result had no capabilities', 'LSP_ACTION_MALFORMED_RESPONSE')
      }
      this.capabilities = capabilities as WireServerCapabilities
      negotiatePositionEncoding(this.capabilities.positionEncoding)
      await this.connection.notify('initialized', {})
    } catch (error) {
      // Handshake failures are always server-side: the initialize request raced no signal here.
      throw serverFailed(error, this.connection.stderrTail)
    }
  }

  /** Await the handshake, tearing the instance down when it ends in failure. */
  private async readyGate(signal?: AbortSignal): Promise<void> {
    if (this.disposed) throw new LspActionError('LSP action client is disposed', 'LSP_ACTION_SERVER_FAILED')
    if (signal?.aborted) throw signal.reason
    try {
      await abortable(this.ready, signal)
    } catch (error) {
      if (!this.dead) await this.startTeardown().catch(() => {})
      throw error
    }
  }

  /** Run one action through the serialized queue. */
  private runSerialized<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    // Serialize behind prior work but observe abort DURING the queue wait too, so a hung earlier
    // action cannot block a later caller's timeout.
    const result = abortable(this.queue, signal).then(run)
    this.queue = this.queue.then(() => result).then(() => undefined, () => undefined)
    return result
  }

  diagnostics(request: ActionRequest, signal?: AbortSignal): Promise<LspDiagnosticsResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      const capabilities = this.requiredCapabilities()
      const pull = supportsPullDiagnostics(capabilities)
      return await this.withDocument(request, signal, async (uri) => {
        if (pull) {
          const payload = await this.sendRequest('textDocument/diagnostic', { textDocument: { uri } }, signal)
          return { kind: 'diagnostics', diagnostics: normalizeDiagnostics(payload) } as const
        }
        const diagnostics = await this.waitForPushedDiagnostics(uri, signal)
        return { kind: 'diagnostics', diagnostics } as const
      })
    })
  }

  formatDocument(request: ActionRequest, signal?: AbortSignal): Promise<LspEditsResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      this.assertSupports('formatDocument', request)
      return await this.withDocument(request, signal, async (uri) => {
        const method = requestMethod({ operation: 'formatDocument', range: request.range })
        const payload = await this.sendRequest(method, {
          textDocument: { uri },
          ...this.spec.formattingOptions === null ? {} : { options: this.spec.formattingOptions },
          ...request.range === undefined ? {} : { range: request.range },
        }, signal)
        return { kind: 'edits', edits: normalizeEdits(payload) } as const
      })
    })
  }

  completion(request: ActionRequest, signal?: AbortSignal): Promise<LspCompletionResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      this.assertSupports('completion', request)
      return await this.withDocument(request, signal, async (uri) => {
        const payload = await this.sendRequest('textDocument/completion', {
          textDocument: { uri },
          position: request.position,
        }, signal)
        return { kind: 'completion', items: normalizeCompletionItems(payload) } as const
      })
    })
  }

  private requiredCapabilities(): WireServerCapabilities {
    if (this.capabilities === undefined) {
      throw new Error('LSP action instance is not initialized')
    }
    return this.capabilities
  }

  /** Reject an action the server did not advertise, or a sync mode this client cannot serve. */
  private assertSupports(operation: 'formatDocument' | 'completion', request: ActionRequest): void {
    const capabilities = this.requiredCapabilities()
    if (!supportsAction(capabilities, operation, request.range !== undefined)) {
      throw new LspActionError(`server does not support ${operation}`, 'LSP_ACTION_UNSUPPORTED')
    }
    if (!supportsTransientOpen(capabilities.textDocumentSync)) {
      throw new LspActionError('server does not support the transient textDocument/didOpen this client requires', 'LSP_ACTION_UNSUPPORTED')
    }
  }

  /** Run `body` inside the transient didOpen→didClose document lifecycle. */
  private async withDocument<T>(
    request: ActionRequest,
    signal: AbortSignal | undefined,
    body: (uri: string) => Promise<T>,
  ): Promise<T> {
    const uri = request.source.fileUrl
    let opened = false
    try {
      if (signal?.aborted) throw signal.reason
      try {
        await abortable(this.connection.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: request.languageId, version: 1, text: request.source.text },
        }), signal)
      } catch (error) {
        // A canceled backpressured write or failed stdin leaves the protocol stream unusable.
        await this.startTeardown().catch(() => {})
        throw error
      }
      opened = true
      return await body(uri)
    } finally {
      // A disposed or closed instance is already tearing down; sending didClose would race it.
      if (opened && !this.dead) {
        try {
          await this.connection.notify('textDocument/didClose', { textDocument: { uri } })
        } catch {
          try {
            await this.startTeardown()
          } catch {
            // Teardown owns all expected process races; preserve the settled action outcome.
          }
        }
      }
    }
  }

  /** Send a request, racing it against abort with a bounded cancel grace. */
  private async sendRequest(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const requestId = this.connection.peekNextId()
    const send = this.connection.request(method, params)
    if (signal === undefined) return await send
    try {
      return await abortable(send, signal)
    } catch (error) {
      if (!signal.aborted) throw error
      this.connection.cancel(requestId)
      // Wait, bounded, for the server to honor the cancellation; if it does not, the request is
      // still running: terminate the instance so nothing outlives the action.
      const grace = AbortSignal.timeout(this.spec.killGraceMs)
      const settled = await Promise.race([
        send.then(markSettled, markSettled),
        new Promise<boolean>((resolve) => {
          if (grace.aborted) {
            resolve(false)
            return
          }
          grace.addEventListener('abort', () => { resolve(false) }, { once: true })
        }),
      ])
      if (!settled) await this.startTeardown().catch(() => {})
      throw error
    }
  }

  /** Collect push-only diagnostics: the latest batch for this URI, or the settle deadline. */
  private waitForPushedDiagnostics(uri: string, signal?: AbortSignal): Promise<LspDiagnostic[]> {
    const key = normalizeUri(uri)
    return new Promise<LspDiagnostic[]>((resolve, reject) => {
      const settle = AbortSignal.timeout(this.spec.diagnosticsSettleMs)
      const fused = signal === undefined ? settle : AbortSignal.any([signal, settle])
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        this.pushWaiters.delete(key)
        const batch = this.pushed.get(key)
        this.pushed.delete(key)
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        resolve(batch ?? [])
      }
      if (fused.aborted) {
        finish()
        return
      }
      this.pushWaiters.set(key, finish)
      fused.addEventListener('abort', finish, { once: true })
    })
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== 'textDocument/publishDiagnostics') return
    const record = params as { uri?: unknown; diagnostics?: unknown } | null
    if (record === null || typeof record !== 'object' || typeof record.uri !== 'string') return
    let diagnostics: LspDiagnostic[]
    try {
      diagnostics = normalizeDiagnostics(record.diagnostics)
    } catch {
      // A malformed push batch cannot fail a notification path; the next pull/settle sees no batch.
      return
    }
    // The latest batch replaces any earlier one for the same URI, per LSP push semantics. URIs are
    // compared normalized: servers re-spell file URIs (tsserver pushes lowercase percent-encoded
    // drive letters), so a raw string comparison would miss every batch.
    const key = normalizeUri(record.uri)
    this.pushed.set(key, diagnostics)
    const waiter = this.pushWaiters.get(key)
    if (waiter !== undefined) waiter()
  }

  private answerServerRequest(method: string, params: unknown): Promise<unknown> {
    if (method === 'workspace/configuration') {
      // Answer every requested item with the one static configuration value.
      const record = params as { items?: unknown[] } | null
      const items = Array.isArray(record?.items) ? record.items : []
      return Promise.resolve(items.map(() => this.spec.configuration))
    }
    if (LIFECYCLE_NOOP_METHODS.has(method)) {
      // Accept lifecycle bookkeeping requests with an empty result; we register nothing dynamic.
      return Promise.resolve(null)
    }
    if (method === 'workspace/applyEdit') {
      // This client never applies server edits; the tool applies them through ctx.fs write-intent.
      return Promise.reject(new Error('workspace/applyEdit is not permitted by this client'))
    }
    return Promise.reject(new Error(`unsupported server request: ${method}`))
  }

  /** Reject queued work, attempt graceful shutdown, then escalate to tree termination. */
  async dispose(): Promise<void> {
    await this.startTeardown()
  }

  /** Publish disposal once and make every caller await the same quiescence boundary. */
  private startTeardown(): Promise<void> {
    this.disposed = true
    this.teardownPromise ??= this.tearDown()
    return this.teardownPromise
  }

  private async tearDown(): Promise<void> {
    const budget = AbortSignal.timeout(this.spec.shutdownTimeoutMs)
    try {
      await abortable(this.connection.request('shutdown', null), budget)
      await abortable(this.connection.notify('exit', null), budget)
      await abortable(this.connection.closed, budget)
    } catch {
      // Graceful shutdown failed or timed out; process-tree cleanup below remains authoritative.
    }
    this.connection.terminate()
    // The terminate escalation already committed to SIGKILL, so quiescence — not another timer —
    // is the postcondition disposal owes its callers.
    await Promise.all([
      this.connection.closed,
      this.connection.waitForProcessTreeExit(),
    ])
  }
}

/** Mark a settled request in the cancel-grace race (either outcome means the request finished). */
function markSettled(): boolean {
  return true
}

/** Normalize a `file:` URI for document identity: decoded path, case-folded on Windows. */
function normalizeUri(uri: string): string {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') return uri
    let path = decodeURIComponent(url.pathname)
    if (process.platform === 'win32') path = path.toLowerCase()
    return `file://${path}`
  } catch {
    return uri
  }
}

/** Wrap a server-side failure with its stderr tail, keeping the structured failure code. */
function serverFailed(error: unknown, stderrTail: string): LspActionError {
  const message = error instanceof Error ? error.message : String(error)
  const tail = stderrTail.trim()
  return new LspActionError(
    tail === '' ? `language server failed: ${message}` : `language server failed: ${message}; stderr: ${tail}`,
    'LSP_ACTION_SERVER_FAILED',
    { cause: error },
  )
}

/** Server→client request methods this client acknowledges with an empty result. */
const LIFECYCLE_NOOP_METHODS = new Set([
  'window/workDoneProgress/create',
  'client/registerCapability',
  'client/unregisterCapability',
])

/**
 * The client capabilities advertised at `initialize`: UTF-16 positions, workspace folders and
 * configuration, completion, and published diagnostics. No dynamic registration; the server's
 * returned capabilities are authoritative.
 */
const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  workspace: { workspaceFolders: true, configuration: true },
  textDocument: {
    synchronization: { dynamicRegistration: false },
    completion: {},
    publishDiagnostics: { relatedInformation: false },
  },
} as const
