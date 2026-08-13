import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { encodeMessage, MessageDecoder } from '../src/framing.ts'

describe('encodeMessage', () => {
  it('frames a message with a UTF-8 byte length header', () => {
    const message = { jsonrpc: '2.0', id: 1, result: 'héllo' }
    const frame = encodeMessage(message)
    const headerEnd = frame.indexOf('\r\n\r\n')
    const header = frame.subarray(0, headerEnd).toString('ascii')
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    expect(header).toBe(`Content-Length: ${body.byteLength}`)
    expect(frame.subarray(headerEnd + 4).toString('utf8')).toBe('{"jsonrpc":"2.0","id":1,"result":"héllo"}')
  })
})

describe('MessageDecoder', () => {
  it('decodes a message split across arbitrary chunk boundaries', () => {
    const decoder = new MessageDecoder(1024)
    const frame = encodeMessage({ id: 7, result: 'ok' })
    const messages: unknown[] = []
    for (let i = 0; i < frame.length; i += 3) {
      messages.push(...decoder.push(frame.subarray(i, i + 3)))
    }
    expect(messages).toEqual([{ id: 7, result: 'ok' }])
  })

  it('decodes multiple messages in one chunk in order', () => {
    const decoder = new MessageDecoder(1024)
    const chunk = Buffer.concat([encodeMessage({ id: 1 }), encodeMessage({ id: 2 })])
    expect(decoder.push(chunk)).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('rejects a frame exceeding maxMessageBytes', () => {
    const decoder = new MessageDecoder(10)
    expect(() => decoder.push(encodeMessage({ payload: 'x'.repeat(64) }))).toThrow(/exceeds the 10-byte limit/)
  })

  it('rejects a header without Content-Length', () => {
    const decoder = new MessageDecoder(1024)
    expect(() => decoder.push(Buffer.from('X-Trace: 1\r\n\r\n{}'))).toThrow(/missing Content-Length/)
  })

  it('rejects an invalid Content-Length value', () => {
    const decoder = new MessageDecoder(1024)
    expect(() => decoder.push(Buffer.from('Content-Length: nope\r\n\r\n'))).toThrow(/missing Content-Length/)
  })

  it('rejects a body that is not valid JSON', () => {
    const decoder = new MessageDecoder(1024)
    expect(() => decoder.push(Buffer.from('Content-Length: 3\r\n\r\nnot'))).toThrow(/not valid JSON/)
  })

  it('rejects an unterminated oversized header', () => {
    const decoder = new MessageDecoder(1024)
    expect(() => decoder.push(Buffer.alloc(64 * 1024 + 1, 0x61))).toThrow(/without a header terminator/)
  })

  it('rejects a nonpositive maxMessageBytes at construction', () => {
    expect(() => new MessageDecoder(0)).toThrow(/positive integer/)
  })
})
