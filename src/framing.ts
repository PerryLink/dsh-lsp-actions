/**
 * LSP stdio framing: `Content-Length`-prefixed JSON messages, encode side and incremental decode
 * side. The decoder retains only one incomplete message plus a bounded header window and rejects
 * oversize, malformed, or unterminated frames — the stream position is then unrecoverable, so the
 * connection fails fast instead of guessing.
 * @module dsh-lsp-actions/framing
 */

import { Buffer } from 'node:buffer'

/** Largest retained header window when no `\r\n\r\n` terminator has arrived yet. */
const MAX_HEADER_BYTES = 64 * 1024

const HEADER_TERMINATOR = '\r\n\r\n'

/**
 * Encode one JSON-RPC message as a Content-Length framed buffer.
 * @param message - the JSON-serializable message.
 * @returns the framed bytes (header + UTF-8 body).
 */
export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.byteLength}${HEADER_TERMINATOR}`, 'ascii')
  return Buffer.concat([header, body])
}

/**
 * Incremental LSP message decoder over an incoming byte stream.
 */
export class MessageDecoder {
  private buffer = Buffer.alloc(0)

  /**
   * @param maxMessageBytes - largest single framed message accepted; exceeding it is fatal.
   */
  constructor(private readonly maxMessageBytes: number) {
    if (!Number.isInteger(maxMessageBytes) || maxMessageBytes < 1) {
      throw new Error('maxMessageBytes must be a positive integer')
    }
  }

  /**
   * Feed a chunk of bytes and drain every complete message.
   * @param chunk - newly received bytes.
   * @returns the decoded messages in delivery order.
   * @throws Error on an oversized frame, a missing Content-Length header, or invalid JSON.
   */
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: unknown[] = []
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_TERMINATOR)
      if (headerEnd < 0) {
        if (this.buffer.length > MAX_HEADER_BYTES) {
          throw new Error(`LSP stream sent ${this.buffer.length} bytes without a header terminator`)
        }
        break
      }
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /^Content-Length: (\d+)\s*$/m.exec(header)
      if (match === null) throw new Error('LSP frame header is missing Content-Length')
      const length = Number(match[1])
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error(`invalid Content-Length "${match[1]}"`)
      }
      if (length > this.maxMessageBytes) {
        throw new Error(`LSP message of ${length} bytes exceeds the ${this.maxMessageBytes}-byte limit`)
      }
      const start = headerEnd + HEADER_TERMINATOR.length
      if (this.buffer.length < start + length) break
      const body = this.buffer.subarray(start, start + length)
      this.buffer = this.buffer.subarray(start + length)
      try {
        messages.push(JSON.parse(body.toString('utf8')) as unknown)
      } catch {
        throw new Error('LSP message body is not valid JSON')
      }
    }
    return messages
  }
}
