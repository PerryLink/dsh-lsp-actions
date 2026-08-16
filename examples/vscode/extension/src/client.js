/**
 * A minimal JSON-RPC client over the editor backend's stdio: spawns the
 * backend, frames newline-delimited JSON-RPC 2.0 requests, and re-emits
 * `lsp.event` notifications as events. Pure transport — no LSP logic lives
 * here; every capability is served by the dsh-lsp-actions backend.
 */

'use strict'

const { spawn } = require('node:child_process')

class BackendClient {
  /**
   * @param {{node: string, bin: string, config: string}} options
   * @param {(line: string) => void} onStderr backend diagnostics land here
   */
  constructor(options, onStderr) {
    this.closed = false
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    this.buffer = ''

    const args = [options.bin]
    if (options.config) args.push(options.config)
    const child = spawn(options.node, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.on('error', (error) => { this.failAll(error) })
    child.on('close', () => { this.failAll(new Error('the editor backend exited')) })
    child.stderr.on('data', (chunk) => { onStderr(String(chunk)) })
    child.stdout.on('data', (chunk) => {
      this.buffer += String(chunk)
      this.drain()
    })
  }

  /** Send one request and resolve with its JSON-RPC result. */
  request(method, params) {
    if (this.closed) return Promise.reject(new Error('not connected'))
    const id = String(this.nextId++)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  /** Send one notification (no response expected). */
  notify(method, params) {
    if (this.closed) return
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  /** Subscribe to `lsp.event` payloads. */
  onEvent(listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Terminate the backend. */
  close() {
    this.closed = true
    this.failAll(new Error('connection closed'))
    this.child.stdin.end()
    this.child.kill()
  }

  drain() {
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let frame
      try {
        frame = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof frame.id === 'string' && this.pending.has(frame.id)) {
        const { resolve, reject } = this.pending.get(frame.id)
        this.pending.delete(frame.id)
        if (frame.error) reject(Object.assign(new Error(frame.error.message || 'JSON-RPC error'), { code: frame.error.code }))
        else resolve(frame.result)
      } else if (frame.method === 'lsp.event') {
        for (const listener of this.listeners) listener(frame.params)
      }
    }
  }

  failAll(error) {
    for (const { reject } of this.pending.values()) reject(error)
    this.pending.clear()
  }
}

module.exports = { BackendClient }
