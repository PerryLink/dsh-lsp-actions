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
import { LspConnection, LspRpcError } from './connection.ts'
import type { ConnectionSpawner } from './connection.ts'
import { canonicalizeWorkspace, normalizeFileUri, readHostSource, workspaceRelativePath } from './host.ts'
import type { HostSource, HostWorkspace } from './host.ts'
import {
  decodeTextEdits,
  negotiatePositionEncoding,
  normalizeCodeActions,
  normalizeCompletionItems,
  normalizeDiagnostics,
  normalizeEdits,
  normalizeInlayHints,
  normalizeSignatures,
  normalizeSymbols,
  normalizeWorkspaceEdit,
  PositionCodec,
  requestMethod,
  supportsAction,
  supportsPullDiagnostics,
  supportsTransientOpen,
} from './translate.ts'
import type { PositionDecoder, WirePositionEncoding, WireServerCapabilities } from './translate.ts'
import type { LspActionResult, LspCodeActionsResult, LspCompletionResult, LspDiagnostic, LspDiagnosticsResult, LspEditsResult, LspInlayHintsResult, LspPosition, LspRange, LspRenameResult, LspSignaturesResult, LspSymbolsResult, LspTextEdit } from './vocabulary.ts'
import { LspActionError } from './vocabulary.ts'
import type { ResolvedServer } from './servers.ts'
import { DEFAULT_MAX_DOCUMENT_BYTES } from './servers.ts'

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
  /** The cursor position, for completion and signature help. */
  readonly position?: LspPosition
  /** The formatting/code-action/inlay-hint range, when the caller narrowed it. */
  readonly range?: LspRange
  /** CodeActionKind filters for code actions (e.g. `quickfix`). */
  readonly onlyKinds?: readonly string[]
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
  readonly diagnosticsDebounceMs: number
  readonly idleTimeoutMs: number
}

/** The raw rename result the instance produces: grouped wire edits still in the server's encoding. */
interface RawRenameResult {
  readonly kind: 'rename'
  readonly edits: Record<string, LspTextEdit[]>
  readonly encoding: WirePositionEncoding
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
    /** Byte cap for documents the rename flow reads back to decode cross-file positions. */
    private readonly maxDocumentBytes: number = DEFAULT_MAX_DOCUMENT_BYTES,
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

  /**
   * Run the code actions action through the routed server; the client only REPORTS edits and
   * commands, it never applies them — applying one is the model's own write/edit decision.
   * @param server - the routed server entry.
   * @param request - the action request (carries the optional range and kind filters).
   * @param signal - optional cancellation.
   * @returns the normalized code actions result.
   */
  codeActions(server: ResolvedServer, request: ActionRequest, signal?: AbortSignal): Promise<LspCodeActionsResult> {
    return this.run(server, request, signal, instance => instance.codeActions(request, signal))
  }

  /**
   * Run a workspace-wide symbol search through the routed server (no document involved).
   * @param server - the routed server entry.
   * @param workspaceRoot - the workspace to search.
   * @param query - the symbol name query.
   * @param signal - optional cancellation.
   * @returns the normalized symbols result.
   */
  workspaceSymbols(server: ResolvedServer, workspaceRoot: string, query: string, signal?: AbortSignal): Promise<LspSymbolsResult> {
    return this.runBare(server, workspaceRoot, signal, instance => instance.workspaceSymbols(query, signal))
  }

  /**
   * Run a workspace-wide symbol search with one document kept open: project-based servers (tsls)
   * refuse document-free `workspace/symbol`, so the routing file stays transiently open for the
   * request and closes afterwards.
   * @param server - the routed server entry.
   * @param request - the action request (whose source is kept open during the search).
   * @param query - the symbol name query.
   * @param signal - optional cancellation.
   * @returns the normalized symbols result.
   */
  workspaceSymbolsInDocument(server: ResolvedServer, request: ActionRequest, query: string, signal?: AbortSignal): Promise<LspSymbolsResult> {
    return this.run(server, request, signal, instance => instance.workspaceSymbolsInDocument(request, query, signal))
  }

  /**
   * Run a document symbol listing through the routed server.
   * @param server - the routed server entry.
   * @param request - the action request.
   * @param signal - optional cancellation.
   * @returns the normalized symbols result.
   */
  documentSymbols(server: ResolvedServer, request: ActionRequest, signal?: AbortSignal): Promise<LspSymbolsResult> {
    return this.run(server, request, signal, instance => instance.documentSymbols(request, signal))
  }

  /**
   * Run signature help through the routed server.
   * @param server - the routed server entry.
   * @param request - the action request (carries the cursor position).
   * @param signal - optional cancellation.
   * @returns the normalized signatures result.
   */
  signatureHelp(server: ResolvedServer, request: ActionRequest, signal?: AbortSignal): Promise<LspSignaturesResult> {
    return this.run(server, request, signal, instance => instance.signatureHelp(request, signal))
  }

  /**
   * Run inlay hints through the routed server.
   * @param server - the routed server entry.
   * @param request - the action request (carries the optional range).
   * @param signal - optional cancellation.
   * @returns the normalized inlay hints result.
   */
  inlayHints(server: ResolvedServer, request: ActionRequest, signal?: AbortSignal): Promise<LspInlayHintsResult> {
    return this.run(server, request, signal, instance => instance.inlayHints(request, signal))
  }

  /**
   * Run a symbol rename through the routed server; the client only RETURNS the grouped edits, it
   * never writes files — the tool applies them through `ctx.fs` write-intent. Cross-document
   * positions are decoded per document (reading the target text for non-utf-16 servers), so the
   * returned edits are utf-16 for every document.
   * @param server - the routed server entry.
   * @param request - the action request (carries the cursor position).
   * @param newName - the new symbol name.
   * @param signal - optional cancellation.
   * @returns the normalized, decoded rename result.
   */
  rename(server: ResolvedServer, request: ActionRequest, newName: string, signal?: AbortSignal): Promise<LspRenameResult> {
    return this.run(server, request, signal, async (instance, querySignal) => {
      const workspace = await canonicalizeWorkspace(this.fs, request.workspaceRoot, querySignal)
      this.assertActive(querySignal)
      const raw = await instance.rename(request, newName, querySignal)
      return this.decodeRenameEdits(raw, request, workspace, querySignal)
    })
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
    return this.runScoped(key, workspace, server, querySignal, body)
  }

  /** The document-free sibling of {@link run}: serves workspace-scoped actions (symbol search). */
  private async runBare<T>(
    server: ResolvedServer,
    workspaceRoot: string,
    signal: AbortSignal | undefined,
    body: (instance: LspActionInstance, signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    this.assertActive(signal)
    const querySignal = this.querySignal(signal)
    const workspace = await canonicalizeWorkspace(this.fs, workspaceRoot, querySignal)
    this.assertActive(querySignal)
    const key = `${server.serverId}\u0000${workspace.target.targetKey}`
    return this.runScoped(key, workspace, server, querySignal, body)
  }

  /** Serialize and run one action attempt pair (retry-once included) for a canonical workspace. */
  private runScoped<T>(
    key: string,
    workspace: HostWorkspace,
    server: ResolvedServer,
    signal: AbortSignal,
    body: (instance: LspActionInstance, signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(key, signal, async () => {
      this.assertActive(signal)
      try {
        return await this.runOnce(key, workspace, server, signal, body)
      } catch (error) {
        // A structured server failure with the first instance dying during its handshake gets one
        // fresh-spawn retry, matching the official stdio host's single bad-transport retry.
        // Mid-action failures surface as plain connection errors and never retry here.
        if (isHandshakeServerFailure(error)) {
          return await this.runOnce(key, workspace, server, signal, body)
        }
        throw error
      }
    })
  }

  /** One attempt: publish/borrow the instance, run the action, evict the dead, arm the idle timer. */
  private async runOnce<T>(
    key: string,
    workspace: HostWorkspace,
    server: ResolvedServer,
    signal: AbortSignal,
    body: (instance: LspActionInstance, signal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    const instance = this.instanceFor(key, workspace, server)
    try {
      return await body(instance, signal)
    } finally {
      // A dead instance can never serve again: evict it so the next call spawns fresh.
      if (instance.dead) {
        await instance.dispose().catch(() => {})
        if (this.instances.get(key) === instance) this.instances.delete(key)
        this.clearIdleTimer(key)
      } else if (server.entry.idleTimeoutMs > 0) {
        this.armIdleTimer(key, instance, server.entry.idleTimeoutMs)
      }
    }
  }

  /** Idle-eviction timers per workspace key; a use resets, a fire disposes and evicts. */
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private armIdleTimer(key: string, instance: LspActionInstance, idleTimeoutMs: number): void {
    this.clearIdleTimer(key)
    const timer = setTimeout(() => {
      if (this.instances.get(key) !== instance) return
      this.instances.delete(key)
      this.idleTimers.delete(key)
      void instance.dispose().catch(() => {})
    }, idleTimeoutMs)
    timer.unref?.()
    this.idleTimers.set(key, timer)
  }

  private clearIdleTimer(key: string): void {
    const timer = this.idleTimers.get(key)
    if (timer === undefined) return
    clearTimeout(timer)
    this.idleTimers.delete(key)
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
      diagnosticsDebounceMs: server.entry.diagnosticsDebounceMs,
      idleTimeoutMs: server.entry.idleTimeoutMs,
    }, this.spawner)
    this.instances.set(key, created)
    return created
  }

  /** Dispose every live instance and block further actions. */
  async disposeAll(): Promise<void> {
    this.disposed = true
    this.lifetime.abort(new LspActionError('LSP action client is disposed', 'LSP_ACTION_SERVER_FAILED'))
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
    const live = [...this.instances.values()]
    this.instances.clear()
    const results = await Promise.allSettled(live.map(instance => instance.dispose()))
    const failures: unknown[] = []
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'lsp-actions instance teardown failed')
  }

  /**
   * Decode one rename's grouped wire edits into utf-16, per document: the origin document uses
   * the source text the server saw; any other document is read back for its codec (utf-16 servers
   * need no read — their positions are already utf-16). An unreadable or out-of-workspace target
   * on a non-utf-16 server is a structured conflict, never silently mis-decoded positions.
   */
  private async decodeRenameEdits(
    raw: RawRenameResult,
    request: ActionRequest,
    workspace: HostWorkspace,
    signal: AbortSignal | undefined,
  ): Promise<LspRenameResult> {
    const decoded: Record<string, LspTextEdit[]> = {}
    const originUri = normalizeFileUri(request.source.fileUrl)
    for (const [uri, edits] of Object.entries(raw.edits)) {
      let codec: PositionCodec | undefined
      if (raw.encoding === 'utf-16') {
        codec = undefined
      } else if (normalizeFileUri(uri) === originUri) {
        codec = new PositionCodec(request.source.text)
      } else {
        const relative = workspaceRelativePath(workspace, uri)
        if (relative === undefined) {
          throw new LspActionError(
            `the language server's rename edits a document outside the workspace (${uri}), whose ${raw.encoding} positions cannot be decoded`,
            'LSP_ACTION_CONFLICT',
          )
        }
        let target: string
        try {
          target = (await readHostSource(this.fs, relative, workspace, this.maxDocumentBytes, signal)).text
        } catch (error) {
          throw new LspActionError(
            `the language server's rename edits a document that cannot be read (${uri}): ${messageOf(error)}`,
            'LSP_ACTION_CONFLICT',
            { cause: error },
          )
        }
        codec = new PositionCodec(target)
      }
      decoded[uri] = decodeTextEdits(edits, codec, raw.encoding)
    }
    return { kind: 'rename', edits: decoded }
  }
}

/** One initialized server process: handshake, serialized queue, and bounded teardown. */
class LspActionInstance {
  private readonly connection: LspConnection
  private capabilities: WireServerCapabilities | undefined
  private positionEncoding: WirePositionEncoding = 'utf-16'
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  private teardownPromise: Promise<void> | undefined
  private processClosed = false
  /** True when the handshake (initialize) ended in failure — the one retryable server state. */
  private handshakeFailed = false
  private readonly ready: Promise<void>
  /** Latest pushed diagnostic batch per document URI (push-only servers). */
  private readonly pushed = new Map<string, LspDiagnostic[]>()
  private readonly pushWaiters = new Map<string, () => void>()
  /** Per-document text (and codec) for the transiently opened document, for push-path conversion. */
  private readonly openedDocs = new Map<string, { readonly text: string; readonly codec: PositionCodec | undefined }>()

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
    this.ready = this.initialize().catch((error: unknown) => {
      this.handshakeFailed = true
      throw error
    })
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
      this.positionEncoding = negotiatePositionEncoding(this.capabilities.positionEncoding)
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
      this.assertSupports('diagnostics', request)
      const capabilities = this.requiredCapabilities()
      const pull = supportsPullDiagnostics(capabilities)
      return await this.withDocument(request, signal, async (uri) => {
        if (pull) {
          const payload = await this.sendRequest('textDocument/diagnostic', { textDocument: { uri } }, signal)
          return { kind: 'diagnostics', diagnostics: normalizeDiagnostics(payload, this.decodeFor(request.source.text)) } as const
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
          ...request.range === undefined ? {} : { range: this.encodeRange(request.source.text, request.range) },
        }, signal)
        return { kind: 'edits', edits: normalizeEdits(payload, this.decodeFor(request.source.text)) } as const
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
          position: this.encodePosition(request.source.text, request.position),
        }, signal)
        return { kind: 'completion', items: normalizeCompletionItems(payload, this.decodeFor(request.source.text)) } as const
      })
    })
  }

  codeActions(request: ActionRequest, signal?: AbortSignal): Promise<LspCodeActionsResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      this.assertSupports('codeAction', request)
      return await this.withDocument(request, signal, async (uri) => {
        const diagnostics = await this.collectDiagnostics(uri, request, signal)
        const range = request.range ?? firstDiagnosticRange(diagnostics) ?? documentRange(request.source.text)
        const encode = this.encodeAll(request.source.text)
        const payload = await this.sendRequest('textDocument/codeAction', {
          textDocument: { uri },
          range: encode === undefined ? range : { start: encode(range.start), end: encode(range.end) },
          context: {
            diagnostics: diagnostics.map(diagnostic => wireDiagnostic(diagnostic, encode)),
            ...request.onlyKinds === undefined ? {} : { only: request.onlyKinds },
          },
        }, signal)
        return { kind: 'codeActions', items: normalizeCodeActions(payload, this.decodeFor(request.source.text)) } as const
      })
    })
  }

  workspaceSymbols(query: string, signal?: AbortSignal): Promise<LspSymbolsResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      const capabilities = this.requiredCapabilities()
      if (!supportsAction(capabilities, 'workspaceSymbol', false)) {
        throw new LspActionError('server does not support workspaceSymbol', 'LSP_ACTION_UNSUPPORTED')
      }
      const payload = await this.sendRequest('workspace/symbol', { query }, signal)
      return { kind: 'symbols', items: normalizeSymbols(payload, undefined) } as const
    })
  }

  /** The document-open variant of {@link workspaceSymbols}, for project-based servers. */
  workspaceSymbolsInDocument(request: ActionRequest, query: string, signal?: AbortSignal): Promise<LspSymbolsResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      const capabilities = this.requiredCapabilities()
      if (!supportsAction(capabilities, 'workspaceSymbol', false)) {
        throw new LspActionError('server does not support workspaceSymbol', 'LSP_ACTION_UNSUPPORTED')
      }
      return await this.withDocument(request, signal, async () => {
        const payload = await this.sendRequest('workspace/symbol', { query }, signal)
        return { kind: 'symbols', items: normalizeSymbols(payload, undefined) } as const
      })
    })
  }

  documentSymbols(request: ActionRequest, signal?: AbortSignal): Promise<LspSymbolsResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      this.assertSupports('documentSymbol', request)
      return await this.withDocument(request, signal, async (uri) => {
        const payload = await this.sendRequest('textDocument/documentSymbol', { textDocument: { uri } }, signal)
        return { kind: 'symbols', items: normalizeSymbols(payload, uri, this.decodeFor(request.source.text)) } as const
      })
    })
  }

  signatureHelp(request: ActionRequest, signal?: AbortSignal): Promise<LspSignaturesResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      this.assertSupports('signatureHelp', request)
      return await this.withDocument(request, signal, async (uri) => {
        const payload = await this.sendRequest('textDocument/signatureHelp', {
          textDocument: { uri },
          position: this.encodePosition(request.source.text, request.position),
        }, signal)
        return { kind: 'signatures', ...normalizeSignatures(payload) } as const
      })
    })
  }

  inlayHints(request: ActionRequest, signal?: AbortSignal): Promise<LspInlayHintsResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      this.assertSupports('inlayHint', request)
      return await this.withDocument(request, signal, async (uri) => {
        const payload = await this.sendRequest('textDocument/inlayHint', {
          textDocument: { uri },
          ...request.range === undefined ? {} : { range: this.encodeRange(request.source.text, request.range) },
        }, signal)
        return { kind: 'inlayHints', items: normalizeInlayHints(payload, this.decodeFor(request.source.text)) } as const
      })
    })
  }

  /**
   * Run a rename through the server and return the grouped wire edits (positions still in the
   * server's encoding; the client decodes them per document). `textDocument/prepareRename` runs
   * first as advisory validation: a `null` answer is the structured no-symbol failure, while a
   * server without the method (or that rejects it on a transient document) still serves rename.
   */
  rename(request: ActionRequest, newName: string, signal?: AbortSignal): Promise<RawRenameResult> {
    return this.runSerialized(signal, async () => {
      await this.readyGate(signal)
      this.assertSupports('rename', request)
      return await this.withDocument(request, signal, async (uri) => {
        const position = this.encodePosition(request.source.text, request.position)
        if (position === undefined) throw new Error('rename requires a cursor position')
        try {
          const prepared = await this.sendRequest('textDocument/prepareRename', {
            textDocument: { uri },
            position,
          }, signal)
          if (prepared === null || prepared === undefined) {
            throw new LspActionError('no symbol to rename at this position', 'LSP_ACTION_NO_SYMBOL')
          }
        } catch (error) {
          // Advisory only: an error RESPONSE (including method-not-found) does not stop the call;
          // a transport failure does.
          if (!(error instanceof LspRpcError)) throw error
        }
        const payload = await this.sendRequest('textDocument/rename', {
          textDocument: { uri },
          position,
          newName,
        }, signal)
        return { kind: 'rename' as const, edits: normalizeWorkspaceEdit(payload), encoding: this.positionEncoding }
      })
    })
  }

  /** Collect this document's diagnostics for a code-action context (pull or push-settle). */
  private async collectDiagnostics(uri: string, request: ActionRequest, signal: AbortSignal | undefined): Promise<LspDiagnostic[]> {
    const capabilities = this.requiredCapabilities()
    if (supportsPullDiagnostics(capabilities)) {
      const payload = await this.sendRequest('textDocument/diagnostic', { textDocument: { uri } }, signal)
      return normalizeDiagnostics(payload, this.decodeFor(request.source.text))
    }
    return await this.waitForPushedDiagnostics(uri, signal)
  }

  /** The codec for one document, or undefined when the server speaks utf-16. */
  private codecFor(text: string): PositionCodec | undefined {
    return this.positionEncoding === 'utf-16' ? undefined : new PositionCodec(text)
  }

  /** Encode a utf-16 cursor position into the server's encoding. */
  private encodePosition(text: string, position: LspPosition | undefined): LspPosition | undefined {
    if (position === undefined) return undefined
    return this.codecFor(text)?.encode(position, this.positionEncoding) ?? position
  }

  /** Encode a utf-16 range into the server's encoding. */
  private encodeRange(text: string, range: LspRange | undefined): LspRange | undefined {
    if (range === undefined) return undefined
    const codec = this.codecFor(text)
    if (codec === undefined) return range
    return { start: codec.encode(range.start, this.positionEncoding), end: codec.encode(range.end, this.positionEncoding) }
  }

  /** A result-side position decoder for one document, or undefined for utf-16 servers. */
  private decodeFor(text: string): PositionDecoder | undefined {
    const codec = this.codecFor(text)
    if (codec === undefined) return undefined
    return position => codec.decode(position, this.positionEncoding)
  }

  /** A position encoder for one document, or undefined for utf-16 servers. */
  private encodeAll(text: string): ((position: LspPosition) => LspPosition) | undefined {
    const codec = this.codecFor(text)
    if (codec === undefined) return undefined
    return position => codec.encode(position, this.positionEncoding)
  }

  private requiredCapabilities(): WireServerCapabilities {
    if (this.capabilities === undefined) {
      throw new Error('LSP action instance is not initialized')
    }
    return this.capabilities
  }

  /** Reject an action the server did not advertise, or a sync mode this client cannot serve. */
  private assertSupports(
    operation: 'diagnostics' | 'formatDocument' | 'completion' | 'codeAction' | 'documentSymbol' | 'signatureHelp' | 'inlayHint' | 'rename',
    request: ActionRequest,
  ): void {
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
    const key = normalizeFileUri(uri)
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
      // Remember the opened text so push notifications (publishDiagnostics) can be decoded from
      // the server's position encoding.
      this.openedDocs.set(key, { text: request.source.text, codec: this.codecFor(request.source.text) })
      return await body(uri)
    } finally {
      this.openedDocs.delete(key)
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

  /**
   * Collect push-only diagnostics for one URI: the LATEST batch wins. Batches replace each other
   * (per LSP push semantics) while the settle window is open, and each push resets a short quiet
   * period (`diagnosticsDebounceMs`), so a server that publishes partial then complete batches
   * yields the complete one; the settle deadline resolves whatever is latest (empty when nothing
   * arrived).
   */
  private waitForPushedDiagnostics(uri: string, signal?: AbortSignal): Promise<LspDiagnostic[]> {
    const key = normalizeFileUri(uri)
    return new Promise<LspDiagnostic[]>((resolve, reject) => {
      const settle = AbortSignal.timeout(this.spec.diagnosticsSettleMs)
      const fused = signal === undefined ? settle : AbortSignal.any([signal, settle])
      let done = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const takeLatest = (): void => {
        if (done) return
        done = true
        if (timer !== undefined) clearTimeout(timer)
        this.pushWaiters.delete(key)
        const batch = this.pushed.get(key)
        this.pushed.delete(key)
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        resolve(batch ?? [])
      }
      // A push resets the quiet period: keep collecting while the server is still talking.
      const onPush = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(takeLatest, this.spec.diagnosticsDebounceMs)
        timer.unref?.()
      }
      if (fused.aborted) {
        takeLatest()
        return
      }
      this.pushWaiters.set(key, onPush)
      fused.addEventListener('abort', takeLatest, { once: true })
    })
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== 'textDocument/publishDiagnostics') return
    const record = params as { uri?: unknown; diagnostics?: unknown } | null
    if (record === null || typeof record !== 'object' || typeof record.uri !== 'string') return
    let diagnostics: LspDiagnostic[]
    try {
      const codec = this.openedDocs.get(normalizeFileUri(record.uri))?.codec
      const decode = codec === undefined
        ? undefined
        : (position: LspPosition) => codec.decode(position, this.positionEncoding)
      diagnostics = normalizeDiagnostics(record.diagnostics, decode)
    } catch {
      // A malformed push batch cannot fail a notification path; the next pull/settle sees no batch.
      return
    }
    // The latest batch replaces any earlier one for the same URI, per LSP push semantics. URIs are
    // compared normalized: servers re-spell file URIs (tsserver pushes lowercase percent-encoded
    // drive letters), so a raw string comparison would miss every batch.
    const key = normalizeFileUri(record.uri)
    this.pushed.set(key, diagnostics)
    const waiter = this.pushWaiters.get(key)
    if (waiter !== undefined) waiter()
  }

  private answerServerRequest(method: string, params: unknown): Promise<unknown> {
    if (method === 'workspace/configuration') {
      // Answer each requested item with its section value when the static configuration object
      // carries the section; otherwise fall back to the one static value for every item.
      const record = params as { items?: unknown[] } | null
      const items = Array.isArray(record?.items) ? record.items : []
      return Promise.resolve(items.map(item => configurationSectionValue(this.spec.configuration, item)))
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

/** Whether a failure is the structured handshake failure the client retries once. */
function isHandshakeServerFailure(error: unknown): boolean {
  return error instanceof LspActionError && error.code === 'LSP_ACTION_SERVER_FAILED'
}

/** Project one normalized diagnostic back to its wire form (for code-action contexts). */
function wireDiagnostic(
  diagnostic: LspDiagnostic,
  encode: ((position: LspPosition) => LspPosition) | undefined,
): Record<string, unknown> {
  const range = encode === undefined
    ? diagnostic.range
    : { start: encode(diagnostic.range.start), end: encode(diagnostic.range.end) }
  return {
    range,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...diagnostic.source === undefined ? {} : { source: diagnostic.source },
    ...diagnostic.code === undefined ? {} : { code: diagnostic.code },
  }
}

/** The range of the first diagnostic, for a code-action request without an explicit range. */
function firstDiagnosticRange(diagnostics: readonly LspDiagnostic[]): LspRange | undefined {
  return diagnostics[0]?.range
}

/** The whole-document range, for a code-action request with neither a range nor diagnostics. */
function documentRange(text: string): LspRange {
  const lines = text.split('\n')
  return {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: (lines[lines.length - 1] ?? '').length },
  }
}

/**
 * The configuration answer for one `workspace/configuration` item: the named section when the
 * static configuration is a plain object carrying it, else the whole static value (the tolerant
 * fallback servers like tsls accept).
 */
function configurationSectionValue(configuration: unknown, item: unknown): unknown {
  const section = (item as { section?: unknown } | null)?.section
  if (
    typeof section === 'string'
    && configuration !== null
    && typeof configuration === 'object'
    && !Array.isArray(configuration)
  ) {
    const value = (configuration as Record<string, unknown>)[section]
    if (value !== undefined) return value
  }
  return configuration
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

/** Coerce an unknown thrown value to a message string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
