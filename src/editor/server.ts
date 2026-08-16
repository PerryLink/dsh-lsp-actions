/**
 * The editor-protocol JSON-RPC server: serves `lsp.actions.list` / `lsp.actions.run` and the
 * client-controlled `lsp.events` subscription over a newline-delimited JSON-RPC stdio channel.
 * This is a thin transport consumer of {@link EditorActionService} — all protocol and permission
 * logic lives there, so any other transport (HTTP, WS, an upstream extension point) can serve the
 * same surface unchanged.
 *
 * Stdout is reserved for protocol frames: enable this only in a dedicated headless composition
 * whose stdout nothing else claims (the plugin refuses nothing at load — the deployment owns that
 * contract, exactly like the official SDK JSON-RPC server).
 * @module dsh-lsp-actions/editor/server
 */

import type { Readable, Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { ActionRunner } from '../runner.ts'
import type { FormatSandboxController } from '../sandbox.ts'
import type { ResolvedConfig } from '../servers.ts'
import { LruDiagnosticsCache } from './cache.ts'
import { EditorActionService } from './service.ts'
import { EditorJsonRpcTransport, EditorProtocolError } from './transport.ts'

/** The three protocol methods, by wire name. */
export const EDITOR_METHOD_LIST = 'lsp.actions.list'
export const EDITOR_METHOD_RUN = 'lsp.actions.run'
export const EDITOR_METHOD_EVENTS = 'lsp.events'

/** Runtime-only transport hooks for tests; production uses process stdio. */
export interface EditorServerOptions {
  readonly input?: Readable
  readonly output?: Writable
}

/** The running editor-protocol runtime: service, transport (when enabled), and disposal. */
export interface EditorProtocolRuntime {
  readonly service: EditorActionService
  readonly server: EditorJsonRpcServer
  dispose(): Promise<void>
}

/**
 * Start the editor protocol for one plugin instance: the bounded diagnostics cache, the
 * transport-agnostic service (listeners attached), and the JSON-RPC stdio server. Every side
 * effect is owned by the returned {@link EditorProtocolRuntime.dispose}, so the plugin's effect
 * scope can reverse the whole surface.
 * @param ctx - the plugin context.
 * @param runner - the seam-first action runner shared with the model tools.
 * @param sandbox - the escalation controller shared with the mutation tools.
 * @param config - the resolved plugin configuration (editor bounds validated by the caller).
 * @returns the runtime to dispose with the plugin.
 */
export function startEditorProtocol(
  ctx: Context,
  runner: ActionRunner,
  sandbox: FormatSandboxController,
  config: ResolvedConfig,
): EditorProtocolRuntime {
  const cache = new LruDiagnosticsCache(config.editor.diagnosticsCacheMaxFiles)
  const service = new EditorActionService(ctx, runner, sandbox, config, cache)
  const stopListeners = service.start()
  // Runtime-only transport hooks (tests): production configs go through the schema, which strips
  // them, so the server claims process stdio — mirroring the official SDK JSON-RPC plugin.
  const hooks = config.editor as { input?: Readable; output?: Writable }
  const server = new EditorJsonRpcServer(service, { input: hooks.input, output: hooks.output })
  server.start()
  return {
    service,
    server,
    dispose: async () => {
      server.close()
      stopListeners()
    },
  }
}

/**
 * Serve the editor protocol over one transport. Construction subscribes to the service's event
 * stream only while a client has subscribed via the `lsp.events` notification, so idle
 * connections never accumulate listeners.
 */
export class EditorJsonRpcServer {
  private readonly transport: EditorJsonRpcTransport
  private eventsDisposer: (() => void) | undefined

  constructor(
    private readonly service: EditorActionService,
    options: EditorServerOptions = {},
  ) {
    this.transport = new EditorJsonRpcTransport(options.input ?? process.stdin, options.output ?? process.stdout)
    this.transport.onRequest(async (method, params) => {
      switch (method) {
        case EDITOR_METHOD_LIST:
          return this.service.list()
        case EDITOR_METHOD_RUN:
          return await this.service.run(params as unknown as Parameters<EditorActionService['run']>[0])
        default:
          throw new EditorProtocolError(-32601, `method not found: ${method}`)
      }
    })
    this.transport.onNotification((method, params) => {
      if (method !== EDITOR_METHOD_EVENTS) return
      const subscribe = typeof params.subscribe === 'boolean' ? params.subscribe : true
      if (subscribe) {
        if (this.eventsDisposer === undefined) {
          this.eventsDisposer = this.service.subscribe(event => this.transport.notify('lsp.event', event as unknown as object))
        }
      } else {
        this.eventsDisposer?.()
        this.eventsDisposer = undefined
      }
    })
  }

  /** Attach the transport to its streams. */
  start(): void {
    this.transport.start()
  }

  /** Detach the transport and drop the event subscription. */
  close(): void {
    this.eventsDisposer?.()
    this.eventsDisposer = undefined
    this.transport.close()
  }
}
