/**
 * The editor protocol's JSON-RPC transport: newline-delimited JSON-RPC 2.0 over byte streams,
 * wire-compatible with the official DeepSeek Harness SDK/ACP transports (one JSON object per line,
 * the same request/response/notification frame rules and error codes). A client that can speak the
 * official SDK wire can speak this wire unchanged — only the method vocabulary differs.
 * @module dsh-lsp-actions/editor/transport
 */

import { randomUUID } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

type JsonRpcId = string | number

/** A request handler: resolves to the response `result`, rejects into a `-32603` error frame. */
export type EditorRequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>

/**
 * A minimal JSON-RPC 2.0 line endpoint over caller-owned streams. Malformed lines are ignored;
 * unknown methods answer `-32601`; handler failures answer `-32603`; notifications without a
 * handler are dropped. {@link start} attaches listeners and {@link close} detaches them.
 */
export class EditorJsonRpcTransport {
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private started = false
  private requestHandler: EditorRequestHandler | undefined
  private notificationHandler: ((method: string, params: Record<string, unknown>) => void) | undefined

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  /** Attach the input listeners and begin reading frames. Idempotent. */
  start(): void {
    if (this.started) return
    this.started = true
    this.input.on('data', this.onData)
    this.input.on('error', this.onInputError)
    this.input.on('end', this.onInputEnd)
  }

  /** Detach listeners. Safe before {@link start}. */
  close(): void {
    this.input.off('data', this.onData)
    this.input.off('error', this.onInputError)
    this.input.off('end', this.onInputEnd)
  }

  /** Install the request handler, replacing any prior handler. */
  onRequest(handler: EditorRequestHandler): void {
    this.requestHandler = handler
  }

  /** Install the notification handler, replacing any prior handler. */
  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
    this.notificationHandler = handler
  }

  /** Send one server→client notification. */
  notify(method: string, params: object): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  /** Wait for the output stream to flush prior writes. */
  flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.output.write('', error => error === null || error === undefined ? resolve() : reject(error))
    })
  }

  private readonly onData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    this.drainLines()
  }

  private drainLines(): void {
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      void this.handleLine(line)
    }
  }

  private readonly onInputError = (): void => {}

  private readonly onInputEnd = (): void => {
    this.buffer += this.decoder.end()
    this.drainLines()
  }

  private async handleLine(line: string): Promise<void> {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return
    const frame = message as Record<string, unknown>
    const id = frame.id
    const method = frame.method
    if ((typeof id === 'string' || typeof id === 'number') && typeof method === 'string') {
      await this.handleRequest(id, method, normalizeParams(frame.params))
      return
    }
    if (typeof method === 'string') {
      this.notificationHandler?.(method, normalizeParams(frame.params))
    }
  }

  private async handleRequest(id: JsonRpcId, method: string, params: Record<string, unknown>): Promise<void> {
    const handler = this.requestHandler
    if (handler === undefined) {
      this.writeError(id, -32601, `method not found: ${method}`)
      return
    }
    try {
      const result = await handler(method, params)
      this.write({ jsonrpc: '2.0', id, result })
    } catch (error) {
      const code = error instanceof EditorProtocolError ? error.jsonRpcCode : -32603
      this.writeError(id, code, error instanceof Error ? error.message : String(error))
    }
  }

  private writeError(id: JsonRpcId, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  private write(message: Record<string, unknown>): void {
    this.output.write(`${JSON.stringify(message)}\n`)
  }
}

/** A protocol-level failure that maps to a specific JSON-RPC error code. */
export class EditorProtocolError extends Error {
  constructor(readonly jsonRpcCode: number, message: string) {
    super(message)
    this.name = 'EditorProtocolError'
  }
}

/** Normalize JSON-RPC params to a plain object (arrays and scalars collapse to `{}`). */
function normalizeParams(params: unknown): Record<string, unknown> {
  return params !== null && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {}
}

/** A fresh, transport-unique request id (used when a peer frame carries none). */
export function freshRequestId(): string {
  return randomUUID()
}
