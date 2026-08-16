#!/usr/bin/env node
/**
 * Clean-profile smoke for the editor action protocol (diagnostics → quickfix → format full chain).
 *
 * Boots the BUILT plugin (lib/) in a fresh temp project against a real LSP process — the
 * deterministic fixture language server — and drives the real newline-delimited JSON-RPC
 * transport end to end: lsp.actions.list → diagnostics.get → quickfix.apply → format, with the
 * lsp.events stream subscribed. Exits 0 only when every step matches its expectation.
 *
 * The real-server legs (typescript-language-server diagnostics + format through the same
 * protocol) run in the vitest suite: `pnpm exec vitest run tests/editor-protocol-tsls.e2e.ts`.
 * The full cordis.yml composition (examples/vscode/backend, app-boot + fs-local + subprocess-local)
 * is the documented runtime path; it needs `npm install` inside examples/vscode/backend.
 *
 * Usage: node verify/smoke-editor-backend.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { delimiter } from 'node:path'
import { accessSync, constants } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
if (!existsSync(join(ROOT, 'lib', 'index.js'))) {
  console.error('[smoke] lib/ missing — building with pnpm build …')
  execFileSync('pnpm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
}

const lib = await import(new URL('../lib/index.js', import.meta.url).href)
const { resolveServers } = await import(new URL('../lib/servers.js', import.meta.url).href)
const { createActionRunner } = await import(new URL('../lib/runner.js', import.meta.url).href)
const { FormatSandboxController } = await import(new URL('../lib/sandbox.js', import.meta.url).href)
const { EditorActionService } = await import(new URL('../lib/editor/service.js', import.meta.url).href)
const { EditorJsonRpcServer } = await import(new URL('../lib/editor/server.js', import.meta.url).href)
const { LruDiagnosticsCache } = await import(new URL('../lib/editor/cache.js', import.meta.url).href)
const { FsError, FsTargetKey, FsVersion } = await import('@deepseek-ai/dsh-fs')

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/lsp-fixture-server.mjs', import.meta.url))

// --- minimal in-process harness replicas (the same shapes tests/helpers/fake-ctx.ts provides) ---

function spawnForTest(spec) {
  const stdinMode = spec.stdio.stdin
  const stdoutMode = spec.stdio.stdout
  const stderrMode = spec.stdio.stderr
  const stdio = [
    stdinMode === 'pipe' ? 'pipe' : 'ignore',
    stdoutMode === 'pipe' ? 'pipe' : stdoutMode === 'inherit' ? 'inherit' : 'pipe',
    stderrMode === 'pipe' ? 'pipe' : stderrMode === 'inherit' ? 'inherit' : 'pipe',
  ]
  const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio, windowsHide: true })
  const tail = () => ({ push: () => {}, readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) })
  const done = new Promise((res, rej) => {
    child.once('error', rej)
    child.once('close', (exitCode, signal) => res({ exitCode, signal }))
  })
  done.catch(() => {})
  const terminate = () => {
    if (child.pid === undefined || child.exitCode !== null) return
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      else process.kill(-child.pid, 'SIGKILL')
    } catch { /* already gone */ }
  }
  spec.signal?.addEventListener('abort', terminate, { once: true })
  return {
    pid: child.pid ?? -1,
    stdin: child.stdin,
    stdout: stdoutMode === 'pipe' ? child.stdout : undefined,
    stderr: stderrMode === 'pipe' ? child.stderr : undefined,
    collected: { stdout: tail(), stderr: tail() },
    done,
    terminate,
    waitForExit: async () => true,
  }
}

function resolveExecutable(command) {
  const candidates = [command]
  if (!command.includes('/') && !command.includes('\\')) {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const extensions = process.platform === 'win32' ? ['', '.EXE', '.CMD', '.BAT'] : ['']
      for (const extension of extensions) candidates.push(join(dir, `${command}${extension}`))
    }
  }
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch { /* next */ }
  }
  throw new Error(`executable "${command}" was not found on PATH`)
}

class FakeFs {
  constructor(root) {
    this.root = root
  }
  get sandboxMode() {
    return undefined
  }
  async resolve(path, opts = {}) {
    const absolute = resolve(opts?.cwd ?? this.root, path)
    return { targetKey: FsTargetKey(absolute), displayPath: absolute }
  }
  processPath(target) {
    return target.targetKey
  }
  fileUrl(target) {
    return pathToFileURL(target.targetKey).href
  }
  contains(parent, child) {
    const prefix = parent.targetKey.endsWith(sep) ? parent.targetKey : `${parent.targetKey}${sep}`
    return child.targetKey === parent.targetKey || child.targetKey.startsWith(prefix)
  }
  async stat(target) {
    try {
      const { statSync } = await import('node:fs')
      const info = statSync(target.targetKey)
      return { version: FsVersion(`v${info.mtimeMs}-${info.size}`), type: info.isDirectory() ? 'directory' : 'file' }
    } catch {
      return undefined
    }
  }
  async readText(target) {
    return await readFile(target.targetKey, 'utf8')
  }
  async streamText(target) {
    const text = await readFile(target.targetKey, 'utf8')
    return { async *[Symbol.asyncIterator]() { yield text } }
  }
  async writeText(target, content, expected) {
    const { statSync } = await import('node:fs')
    const before = await readFile(target.targetKey, 'utf8')
    if (expected?.kind === 'replaceIfVersion') {
      const info = statSync(target.targetKey)
      if (FsVersion(`v${info.mtimeMs}-${info.size}`) !== expected.version) {
        throw new FsError('the target changed since it was read', 'FS_STALE_VERSION')
      }
    }
    await writeFile(target.targetKey, content)
    const after = statSync(target.targetKey)
    return { operation: 'update', version: FsVersion(`v${after.mtimeMs}-${after.size}`), before, after: content }
  }
}

// --- the smoke run ---

const workspace = await mkdtemp(join(tmpdir(), 'dsh-lsp-smoke-'))
await writeFile(join(workspace, 'a.ts'), 'alpha\nx abcd\n    beta\ngamma\n')
const fs = new FakeFs(await import('node:fs/promises').then(m => m.realpath(workspace)))
const ctx = {
  tools: { register: () => () => {} },
  fs,
  subprocess: { spawn: (spec) => spawnForTest(spec), resolveExecutable: (c) => Promise.resolve(resolveExecutable(c)) },
  waterfall: async (name, ...args) => {
    if (name === 'fs/write-intent') return undefined
    const next = args.at(-1)
    return typeof next === 'function' ? await next() : undefined
  },
  emit: () => {},
  get: () => undefined,
  on: () => () => {},
  effect: () => Promise.resolve(),
}

const servers = await resolveServers(ctx, {
  fixture: {
    command: process.execPath,
    args: [FIXTURE],
    extensionToLanguage: { '.ts': 'typescript' },
    fileGlobs: [],
    env: {},
    initializationOptions: null,
    configuration: null,
    formattingOptions: { tabSize: 2, insertSpaces: true },
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 1_000_000,
    killGraceMs: 2_000,
    shutdownTimeoutMs: 2_000,
    diagnosticsSettleMs: 500,
    diagnosticsDebounceMs: 100,
    idleTimeoutMs: 0,
  },
})

const CONFIG = {
  servers: {},
  editor: { enabled: true, requestTimeoutMs: 60_000, diagnosticsCacheMaxFiles: 64 },
  maxDiagnostics: 200,
  maxCompletionItems: 20,
  maxCodeActions: 50,
  maxSymbols: 100,
  maxSignatures: 10,
  maxInlayHints: 200,
  maxResultChars: 16_000,
  maxDocumentBytes: 4_000_000,
  timeoutMs: 60_000,
}

const sandbox = new FormatSandboxController(ctx)
const client = new lib.LspActionClient(ctx.subprocess, ctx.fs, CONFIG.maxDocumentBytes)
const runner = createActionRunner({ getSeam: () => undefined, client, servers })
const cache = new LruDiagnosticsCache(CONFIG.editor.diagnosticsCacheMaxFiles)
const service = new EditorActionService(ctx, runner, sandbox, CONFIG, cache)
const stopListeners = service.start()

const input = new PassThrough()
const output = new PassThrough()
const server = new EditorJsonRpcServer(service, { input, output })
server.start()

let buffer = ''
let nextId = 1
const pending = new Map()
const events = []
output.on('data', (chunk) => {
  buffer += String(chunk)
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const frame = JSON.parse(line)
    if (typeof frame.id === 'string' && pending.has(frame.id)) {
      const { resolve: res, reject: rej } = pending.get(frame.id)
      pending.delete(frame.id)
      frame.error ? rej(new Error(frame.error.message)) : res(frame.result)
    } else if (frame.method === 'lsp.event') {
      events.push(frame.params)
    }
  }
})

function request(method, params) {
  const id = `s_${nextId++}`
  return new Promise((res, rej) => {
    pending.set(id, { resolve: res, reject: rej })
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

const failures = []
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

console.log('[smoke] clean-profile editor backend — diagnostics → quickfix → format over JSON-RPC')
console.log(`[smoke] workspace: ${workspace}`)

const list = await request('lsp.actions.list', {})
check('lsp.actions.list advertises the v1 protocol', list.protocol === 'lsp-actions/v1' && list.version === 1, `${list.protocol} v${list.version}`)
check('the v1 catalog carries all four actions', ['diagnostics.get', 'completion.get', 'quickfix.apply', 'format'].every(id => list.actions.some(a => a.action === id)), list.actions.map(a => a.action).join(', '))

input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'lsp.events', params: { subscribe: true } })}\n`)

const diag = await request('lsp.actions.run', { action: 'diagnostics.get', requestId: 'd1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
check('diagnostics.get succeeded', diag.status === 'succeeded' && diag.result.kind === 'diagnostics')
check('diagnostics carried the fixture error', diag.result?.diagnostics?.[0]?.message === 'fixture error', diag.result?.diagnostics?.[0]?.message)

const quickfix = await request('lsp.actions.run', { action: 'quickfix.apply', requestId: 'q1', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix fixture error' } })
check('quickfix.apply succeeded', quickfix.status === 'succeeded' && quickfix.result?.kind === 'quickfixApplied', quickfix.result?.title)
check('quickfix wrote through the official write path', await readFile(join(workspace, 'a.ts'), 'utf8') === 'alpha\nxfixedbcd\n    beta\ngamma\n')

const format = await request('lsp.actions.run', { action: 'format', requestId: 'f1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
check('format succeeded', format.status === 'succeeded' && format.result?.kind === 'formatted', `${format.result?.appliedEdits} edit(s)`)
check('format rewrote the indentation', await readFile(join(workspace, 'a.ts'), 'utf8') === 'alpha\nxfixedbcd\n\tbeta\ngamma\n')

await new Promise(res => setTimeout(res, 150))
const kinds = events.map(event => event.kind)
check('lsp.events streamed diagnostics.updated', kinds.includes('diagnostics.updated'))
check('lsp.events streamed action.status', kinds.includes('action.status'))
check('lsp.events streamed file.changed', kinds.includes('file.changed'))

const stale = await request('lsp.actions.run', { action: 'diagnostics.get', requestId: 'd2', protocol: 'lsp-actions/v9' })
check('protocol version mismatch fails with the stable code', stale.status === 'failed' && stale.error?.code === 'LSP_PROTOCOL_VERSION_UNSUPPORTED', stale.error?.code)

server.close()
stopListeners()
await client.disposeAll()
await rm(workspace, { recursive: true, force: true })

console.log('')
if (failures.length === 0) {
  console.log('[smoke] PASS — the full diagnostics → quickfix → format chain works on a clean profile.')
  process.exit(0)
} else {
  console.error(`[smoke] FAIL — ${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
