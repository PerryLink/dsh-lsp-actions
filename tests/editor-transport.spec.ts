import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { EditorJsonRpcTransport, EditorProtocolError, freshRequestId } from '../src/editor/transport.ts'

/** Accumulate JSON-RPC frames written to one stream and deliver them by id. */
class FrameSink {
  private buffer = ''
  private readonly frames = new Map<string, Record<string, unknown>>()
  private readonly waiters = new Map<string, Array<(frame: Record<string, unknown>) => void>>()
  private events: unknown[] = []

  constructor(stream: PassThrough) {
    stream.on('data', (chunk: Buffer | string) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      this.drain()
    })
  }

  next(id: string | number): Promise<Record<string, unknown>> {
    return new Promise(resolve => {
      const key = String(id)
      const buffered = this.frames.get(key)
      if (buffered !== undefined) {
        this.frames.delete(key)
        resolve(buffered)
        return
      }
      const list = this.waiters.get(key) ?? []
      list.push(resolve)
      this.waiters.set(key, list)
    })
  }

  private drain(): void {
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      const frame = JSON.parse(line) as Record<string, unknown>
      if (typeof frame.id === 'string' || typeof frame.id === 'number') {
        const key = String(frame.id)
        const list = this.waiters.get(key)
        if (list !== undefined && list.length > 0) {
          const waiter = list.shift() as (frame: Record<string, unknown>) => void
          waiter(frame)
        } else {
          this.frames.set(key, frame)
        }
      } else {
        this.events.push(frame)
      }
    }
  }
}

function send(input: PassThrough, id: string, method: string, params: unknown): void {
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
}

function notify(input: PassThrough, method: string, params: unknown): void {
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
}

describe('EditorJsonRpcTransport', () => {
  let input: PassThrough
  let output: PassThrough
  let sink: FrameSink
  let transport: EditorJsonRpcTransport
  let handler: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined
  let notifications: Array<{ method: string; params: Record<string, unknown> }>

  beforeEach(() => {
    input = new PassThrough()
    output = new PassThrough()
    sink = new FrameSink(output)
    transport = new EditorJsonRpcTransport(input, output)
    handler = undefined
    notifications = []
    transport.onRequest(async (method, params) => {
      if (handler !== undefined) return await handler(method, params)
      throw new Error('no handler installed in this test')
    })
    transport.onNotification((method, params) => { notifications.push({ method, params }) })
  })

  afterEach(() => {
    transport.close()
  })

  it('answers requests and forwards notifications with normalized params', async () => {
    handler = async (method, params) => ({ echoed: method, params })
    transport.start()
    send(input, 'r1', 'ping', { value: 1 })
    const frame = await sink.next('r1')
    expect(frame.result).toEqual({ echoed: 'ping', params: { value: 1 } })
    notify(input, 'lsp.event', { kind: 'file.changed' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notifications).toContainEqual({ method: 'lsp.event', params: { kind: 'file.changed' } })
  })

  it('start is idempotent and close is safe before start', async () => {
    transport.start()
    transport.start()
    handler = async () => 'ok'
    send(input, 'r2', 'ping', {})
    expect((await sink.next('r2')).result).toBe('ok')
    // close() before any start on a fresh transport must not throw.
    const fresh = new EditorJsonRpcTransport(new PassThrough(), new PassThrough())
    fresh.close()
  })

  it('handles string chunks when the input stream is set to a text encoding', async () => {
    input.setEncoding('utf8')
    handler = async () => 'text'
    transport.start()
    send(input, 'r3', 'ping', {})
    expect((await sink.next('r3')).result).toBe('text')
  })

  it('skips blank lines between frames', async () => {
    handler = async method => `reply:${method}`
    transport.start()
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'first', params: {} })}\n\n${JSON.stringify({ jsonrpc: '2.0', id: 'b', method: 'second', params: {} })}\n`)
    expect((await sink.next('a')).result).toBe('reply:first')
    expect((await sink.next('b')).result).toBe('reply:second')
  })

  it('ignores malformed JSON lines and keeps serving', async () => {
    handler = async () => 'ok'
    transport.start()
    input.write('this is not json\n')
    send(input, 'r4', 'ping', {})
    expect((await sink.next('r4')).result).toBe('ok')
  })

  it('ignores non-object frames (arrays, null, scalars) and keeps serving', async () => {
    handler = async () => 'ok'
    transport.start()
    input.write('[1, 2, 3]\nnull\n42\n')
    send(input, 'r5', 'ping', {})
    expect((await sink.next('r5')).result).toBe('ok')
  })

  it('answers -32601 when no request handler is installed', async () => {
    const bare = new EditorJsonRpcTransport(input, output)
    bare.start()
    try {
      send(input, 'r6', 'lsp.actions.list', {})
      const frame = await sink.next('r6')
      expect(frame.error).toMatchObject({ code: -32601 })
      expect((frame.error as { message: string }).message).toContain('method not found')
    } finally {
      bare.close()
    }
  })

  it('answers handler failures with -32603 and the error message', async () => {
    handler = async () => {
      throw new Error('boom')
    }
    transport.start()
    send(input, 'r7', 'ping', {})
    const frame = await sink.next('r7')
    expect(frame.error).toMatchObject({ code: -32603, message: 'boom' })
  })

  it('answers non-Error handler failures with -32603 and a string message', async () => {
    handler = async () => {
      throw 'boom-string'
    }
    transport.start()
    send(input, 'r8', 'ping', {})
    const frame = await sink.next('r8')
    expect(frame.error).toMatchObject({ code: -32603, message: 'boom-string' })
  })

  it('answers an EditorProtocolError with its own JSON-RPC code', async () => {
    handler = async () => {
      throw new EditorProtocolError(-32000, 'protocol hiccup')
    }
    transport.start()
    send(input, 'r9', 'ping', {})
    expect((await sink.next('r9')).error).toMatchObject({ code: -32000, message: 'protocol hiccup' })
  })

  it('normalizes array and scalar params to an empty object', async () => {
    const seen: Record<string, unknown>[] = []
    handler = async (_method, params) => {
      seen.push(params)
      return 'ok'
    }
    transport.start()
    send(input, 'r10', 'ping', [1, 2])
    send(input, 'r11', 'ping', 'scalar')
    await sink.next('r10')
    await sink.next('r11')
    expect(seen).toEqual([{}, {}])
  })

  it('flush resolves once prior writes are flushed', async () => {
    handler = async () => 'ok'
    transport.start()
    send(input, 'r12', 'ping', {})
    await sink.next('r12')
    await expect(transport.flush()).resolves.toBeUndefined()
  })

  it('freshRequestId returns a unique string id', () => {
    const first = freshRequestId()
    const second = freshRequestId()
    expect(first).not.toBe(second)
    expect(typeof first).toBe('string')
    expect(typeof second).toBe('string')
  })
})
