/**
 * A JSON-RPC endpoint over one language server spawned through the subprocess capability. Owns id
 * correlation, outbound requests/notifications, inbound server→client requests (answering
 * `workspace/configuration` from static config and accepting lifecycle bookkeeping), notification
 * observers (the diagnostics push path), and fail-fast framing errors. Terminates through the
 * subprocess handle's tree-scoped escalation.
 * @module dsh-lsp-actions/connection
 */

import type { Writable } from 'node:stream'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { encodeMessage, MessageDecoder } from './framing.ts'

/** How to launch the server and answer its configuration requests. */
export interface ConnectionSpec {
  /** The resolved absolute executable path (no shell). */
  readonly command: string
  /** Arguments passed to the executable. */
  readonly args: readonly string[]
  /** The child's working directory (the canonical workspace). */
  readonly cwd: string
  /** Explicit child environment overrides; the subprocess provider owns its ambient scrub. */
  readonly env: Record<string, string>
  /** Largest single framed message accepted from the server. */
  readonly maxMessageBytes: number
  /** Largest stderr tail retained for diagnostics. */
  readonly maxStderrBytes: number
  /** The subprocess spec's `graceMs` for the terminate escalation. */
  readonly killGraceMs: number
  /** Static answer to every `workspace/configuration` item. */
  readonly configuration: unknown
}

/** Spawn one subprocess for this connection (the client passes `ctx.subprocess.spawn`). */
export type ConnectionSpawner = (spec: SubprocessSpawnSpec) => SubprocessHandle

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const writeConnectionMessage = (stdin: Writable, message: unknown, done: (error?: Error | null) => void): void => {
  stdin.write(encodeMessage(message), done)
}

/**
 * A live JSON-RPC endpoint bound to one child process. Requests reject immediately after the
 * process closes or the protocol stream fails, so no caller can hang on a dead server.
 */
export class LspConnection {
  private readonly handle: SubprocessHandle
  private readonly stdin: Writable
  private readonly decoder: MessageDecoder
  private readonly pending = new Map<number, Pending>()
  private readonly notificationHandlers = new Set<(method: string, params: unknown) => void>()
  private nextId = 1
  private closeReason: Error | undefined
  /** Resolves once the process has fully exited and every pending request was rejected. */
  readonly closed: Promise<void>

  /**
   * @param spec - how to launch the server and answer its configuration requests.
   * @param spawner - the subprocess seam's spawn (the client passes `ctx.subprocess.spawn`).
   * @param onServerRequest - answers a server→client request; rejects to send an error response.
   */
  constructor(
    spec: ConnectionSpec,
    spawner: ConnectionSpawner,
    private readonly onServerRequest: (method: string, params: unknown) => Promise<unknown>,
  ) {
    this.decoder = new MessageDecoder(spec.maxMessageBytes)
    this.handle = spawner({
      argv: [spec.command, ...spec.args],
      cwd: spec.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: spec.maxStderrBytes },
      },
      graceMs: spec.killGraceMs,
      env: spec.env,
    })
    if (this.handle.stdin === undefined || this.handle.stdout === undefined) {
      throw new Error('lsp-actions: subprocess implementation dropped a piped protocol stream')
    }
    this.stdin = this.handle.stdin
    this.closed = new Promise<void>((resolve) => {
      const close = (): void => {
        const reason = this.closeReason ?? new Error(this.exitMessage())
        this.closeReason = reason
        this.failAll(reason)
        resolve()
      }
      this.handle.done.then(close, (error: unknown) => {
        // A spawn-level failure never produces a close event; the rejection is the close boundary.
        this.fail(asError(error))
        close()
      })
    })
    this.stdin.on('error', (error) => { this.fail(error) })
    this.handle.stdout.on('data', (chunk: Buffer) => { this.onStdout(chunk) })
  }

  /** The child's pid, or `-1` when the spawn produced no pid. */
  get pid(): number {
    return this.handle.pid
  }

  /** The retained stderr tail, for diagnostics on a failed server. */
  get stderrTail(): string {
    return this.handle.collected.stderr?.readFrom(0).text ?? ''
  }

  /** Whether the transport has failed even if the close event has not arrived yet. */
  get failed(): boolean {
    return this.closeReason !== undefined
  }

  /**
   * Observe an inbound server→client notification (e.g. `textDocument/publishDiagnostics`).
   * @param handler - invoked synchronously per notification, in registration order.
   */
  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandlers.add(handler)
  }

  /**
   * Send a request and await its result.
   * @param method - the JSON-RPC method.
   * @param params - the request params.
   * @returns the response result; rejects on an error response, write failure, or close.
   */
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => {
      if (this.closeReason !== undefined) {
        reject(this.closeReason)
        return
      }
      this.pending.set(id, { resolve, reject })
      void this.write({ jsonrpc: '2.0', id, method, params }).catch(() => {})
    })
    // A caller that stops awaiting (e.g. an aborted query) leaves this promise to reject at close;
    // this handler keeps that rejection from surfacing as an unhandled rejection.
    promise.catch(() => {})
    return promise
  }

  /**
   * Send a notification (no id, no response).
   * @param method - the JSON-RPC method.
   * @param params - the notification params.
   * @returns a promise that settles when the framed notification has been written.
   */
  notify(method: string, params: unknown): Promise<void> {
    return this.write({ jsonrpc: '2.0', method, params })
  }

  /**
   * Send a `$/cancelRequest` for an in-flight request id (best-effort; ignores write failure).
   * @param requestId - the numeric id of the request to cancel.
   */
  cancel(requestId: number): void {
    void this.write({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: requestId } }).catch(() => {})
  }

  /** The id the NEXT `request()` will use, so the client can pre-arm a cancel. */
  peekNextId(): number {
    return this.nextId
  }

  /** Terminate the server's process tree (the seam's SIGTERM→grace→SIGKILL escalation; idempotent). */
  terminate(): void {
    this.handle.terminate()
  }

  /** Wait until the owned process tree has exited. */
  async waitForProcessTreeExit(signal?: AbortSignal): Promise<boolean> {
    return await this.handle.waitForExit(signal)
  }

  private onStdout(chunk: Buffer): void {
    let messages: unknown[]
    try {
      messages = this.decoder.push(chunk)
    } catch (error) {
      this.fail(asError(error))
      this.handle.terminate()
      return
    }
    for (const message of messages) this.dispatch(message)
  }

  private dispatch(message: unknown): void {
    if (message === null || typeof message !== 'object') return
    const frame = message as Record<string, unknown>
    const id = frame.id
    const method = frame.method
    if (typeof method === 'string' && (typeof id === 'number' || typeof id === 'string')) {
      void this.handleServerRequest(id, method, frame.params).catch(() => {})
      return
    }
    if (typeof method === 'string') {
      for (const handler of this.notificationHandlers) handler(method, frame.params)
      return
    }
    if (typeof id === 'number') this.handleResponse(id, frame)
  }

  private async handleServerRequest(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.onServerRequest(method, params)
      await this.write({ jsonrpc: '2.0', id, result })
    } catch (error) {
      await this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: asError(error).message } })
    }
  }

  private handleResponse(id: number, frame: Record<string, unknown>): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    const error = frame.error
    if (error !== null && typeof error === 'object') {
      const record = error as Record<string, unknown>
      pending.reject(new Error(typeof record.message === 'string' ? record.message : 'LSP error response'))
      return
    }
    pending.resolve(frame.result)
  }

  private write(message: unknown): Promise<void> {
    if (this.closeReason !== undefined) return Promise.reject(this.closeReason)
    return new Promise<void>((resolve, reject) => {
      const done = (error?: Error | null): void => {
        if (error === undefined || error === null) {
          resolve()
          return
        }
        this.fail(error)
        reject(error)
      }
      try {
        writeConnectionMessage(this.stdin, message, done)
      } catch (error) {
        const failure = asError(error)
        this.fail(failure)
        reject(failure)
      }
    })
  }

  /** The exit-close error message, appending the retained stderr tail when the server wrote any. */
  private exitMessage(): string {
    const tail = this.stderrTail.trim()
    return tail === '' ? 'language server exited' : `language server exited; stderr: ${tail}`
  }

  private fail(error: Error): void {
    if (this.closeReason === undefined) this.closeReason = error
    this.failAll(error)
  }

  private failAll(error: Error): void {
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const pending of waiting) pending.reject(error)
  }
}

/** Coerce an unknown thrown value to an `Error`. */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
