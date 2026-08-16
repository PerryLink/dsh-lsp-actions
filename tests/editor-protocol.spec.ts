import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { LspActionClient } from '../src/client.ts'
import { LruDiagnosticsCache } from '../src/editor/cache.ts'
import { EditorActionService } from '../src/editor/service.ts'
import { EditorJsonRpcServer } from '../src/editor/server.ts'
import { createActionRunner } from '../src/runner.ts'
import { FormatSandboxController } from '../src/sandbox.ts'
import { resolveServers } from '../src/servers.ts'
import type { ResolvedConfig, ResolvedServerEntry } from '../src/servers.ts'
import type { ActionRunner, RunnerRequest } from '../src/runner.ts'
import type { LspDiagnostic, LspTextEdit } from '../src/vocabulary.ts'
import { createFakeContext, disposeFakeContext } from './helpers/fake-ctx.ts'
import type { FakeContext } from './helpers/fake-ctx.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/lsp-fixture-server.mjs', import.meta.url))

const CONFIG: ResolvedConfig = {
  servers: {},
  editor: { enabled: true, requestTimeoutMs: 60_000, diagnosticsCacheMaxFiles: 2 },
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

function fullServerEntry(command: string, extensionToLanguage: Record<string, string>, args: string[] = []): ResolvedServerEntry {
  return {
    command,
    extensionToLanguage,
    fileGlobs: [],
    args,
    env: {},
    initializationOptions: null,
    configuration: null,
    formattingOptions: null,
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 1_000_000,
    killGraceMs: 2_000,
    shutdownTimeoutMs: 2_000,
    diagnosticsSettleMs: 500,
    diagnosticsDebounceMs: 100,
    idleTimeoutMs: 0,
  }
}

/** A canned runner answering each op from fixed results (no server process). */
function fakeRunner(results: {
  diagnostics?: { kind: 'diagnostics'; diagnostics: LspDiagnostic[] }
  formatDocument?: { kind: 'edits'; edits: LspTextEdit[] }
  completion?: { kind: 'completion'; items: { label: string }[] }
  codeActions?: { kind: 'codeActions'; items: Array<{ title: string; edits: Record<string, LspTextEdit[]> }> }
}): { runner: ActionRunner; calls: string[] } {
  const calls: string[] = []
  const unexpected = (): never => {
    throw new Error('unexpected runner result')
  }
  const runner: ActionRunner = {
    diagnostics: async () => {
      calls.push('diagnostics')
      return results.diagnostics ?? unexpected()
    },
    formatDocument: async () => {
      calls.push('formatDocument')
      return results.formatDocument ?? unexpected()
    },
    completion: async () => {
      calls.push('completion')
      return results.completion ?? unexpected()
    },
    codeActions: async () => {
      calls.push('codeActions')
      return results.codeActions ?? unexpected()
    },
    workspaceSymbols: async () => unexpected(),
    documentSymbols: async () => unexpected(),
    signatureHelp: async () => unexpected(),
    inlayHints: async () => unexpected(),
    rename: async () => unexpected(),
  }
  return { runner, calls }
}

async function assembleService(fake: FakeContext, config: ResolvedConfig = CONFIG, runner?: ActionRunner): Promise<{
  service: EditorActionService
  cache: LruDiagnosticsCache
  stop: () => void
}> {
  const sandbox = new FormatSandboxController(fake.ctx as never)
  const client = new LspActionClient(fake.ctx.subprocess as never, fake.ctx.fs as never, config.maxDocumentBytes)
  const resolved = runner ?? createActionRunner({
    getSeam: () => fake.ctx.get('lsp') as never,
    client,
    servers: [],
  })
  const cache = new LruDiagnosticsCache(config.editor.diagnosticsCacheMaxFiles)
  const service = new EditorActionService(fake.ctx as never, resolved, sandbox, config, cache)
  const stop = service.start()
  return { service, cache, stop }
}

describe('EditorActionService.list', () => {
  let fake: FakeContext

  beforeEach(async () => {
    fake = await createFakeContext({ cwd: process.cwd() })
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('advertises the v1 protocol, the four actions, and the addressable sessions', async () => {
    await disposeFakeContext(fake)
    fake = await recreateWithSessions()
    const { service, stop } = await assembleService(fake)
    try {
      const list = service.list()
      expect(list.protocol).toBe('lsp-actions/v1')
      expect(list.version).toBe(1)
      expect(list.actions.map(descriptor => descriptor.action)).toEqual(['diagnostics.get', 'completion.get', 'quickfix.apply', 'format'])
      expect(list.actions.find(descriptor => descriptor.action === 'quickfix.apply')?.writes).toBe(true)
      expect(list.actions.find(descriptor => descriptor.action === 'diagnostics.get')?.writes).toBe(false)
      expect(list.sessions).toEqual([{ sessionId: 's1', cwd: '/ws', live: false }])
    } finally {
      stop()
    }
  })

  it('lists no sessions when no sessions service is composed', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      expect(service.list().sessions).toEqual([])
    } finally {
      stop()
    }
  })
})

describe('EditorActionService.run', () => {
  let fake: FakeContext
  let workspace: string

  beforeEach(async () => {
    fake = await createFakeContext({ cwd: process.cwd() })
    workspace = join(fake.fs.root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'alpha\n    beta\ngamma\n')
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('answers a protocol-version mismatch through the failed envelope', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({ action: 'diagnostics.get', protocol: 'lsp-actions/v9' })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_PROTOCOL_VERSION_UNSUPPORTED')
    } finally {
      stop()
    }
  })

  it('answers a missing action through the failed envelope', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({} as never)
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_INVALID_ARGS')
    } finally {
      stop()
    }
  })

  it('answers an unknown action through the failed envelope with the stable code', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({ action: 'lsp.what', requestId: 'r1' })
      expect(result).toMatchObject({ requestId: 'r1', status: 'failed', error: { code: 'LSP_ACTION_UNKNOWN' } })
    } finally {
      stop()
    }
  })

  it('runs diagnostics.get: caps, caches with freshness, and emits diagnostics.updated', async () => {
    const { runner } = fakeRunner({
      diagnostics: { kind: 'diagnostics', diagnostics: [
        { severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, message: 'e', source: 'ts', code: 42 },
        { severity: 2, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, message: 'w' },
      ] },
    })
    const { service, cache, stop } = await assembleService(fake, CONFIG, runner)
    const events: unknown[] = []
    const off = service.subscribe(event => { events.push(event) })
    try {
      const result = await service.run({ action: 'diagnostics.get', requestId: 'd1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('succeeded')
      const payload = result.result as { kind: string; diagnostics: unknown[]; truncated: boolean; total: number }
      expect(payload.kind).toBe('diagnostics')
      expect(payload.diagnostics).toHaveLength(2)
      expect(payload.truncated).toBe(false)
      expect(payload.total).toBe(2)
      const cached = cache.get(join(workspace, 'a.ts'))
      expect(cached?.diagnostics).toHaveLength(2)
      expect(cached?.version).toBeDefined()
      expect(events).toContainEqual(expect.objectContaining({ kind: 'diagnostics.updated', filePath: 'a.ts', total: 2 }))
      expect(events).toContainEqual({ kind: 'action.status', requestId: 'd1', action: 'diagnostics.get', status: 'started' })
      expect(events).toContainEqual({ kind: 'action.status', requestId: 'd1', action: 'diagnostics.get', status: 'succeeded' })
    } finally {
      off()
      stop()
    }
  })

  it('runs completion.get with zero-based positions unchanged on the wire', async () => {
    const { runner, calls } = fakeRunner({ completion: { kind: 'completion', items: [{ label: 'alpha' }] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'completion.get', params: { filePath: 'a.ts', workspaceRoot: workspace, position: { line: 2, character: 3 } } })
      expect(result.status).toBe('succeeded')
      expect((result.result as { kind: string; items: unknown[] }).kind).toBe('completion')
      expect((result.result as { position: { line: number; character: number } }).position).toEqual({ line: 2, character: 3 })
      expect(calls).toEqual(['completion'])
    } finally {
      stop()
    }
  })

  it('runs quickfix.apply by title, writes the edits through the official write path, and invalidates the cache', async () => {
    const uri = pathToFileURL(join(workspace, 'a.ts')).href
    const { runner } = fakeRunner({
      codeActions: { kind: 'codeActions', items: [
        { title: 'Fix alpha', edits: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'ALPHA' }] } },
      ] },
    })
    const { service, cache, stop } = await assembleService(fake, CONFIG, runner)
    const events: unknown[] = []
    const off = service.subscribe(event => { events.push(event) })
    try {
      const result = await service.run({ action: 'quickfix.apply', requestId: 'q1', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix alpha', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } } })
      expect(result.status).toBe('succeeded')
      expect(result.result).toMatchObject({ kind: 'quickfixApplied', title: 'Fix alpha', filesChanged: 1, appliedEdits: 1 })
      expect(await readFile(join(workspace, 'a.ts'), 'utf8')).toBe('ALPHA\n    beta\ngamma\n')
      expect(cache.get(join(workspace, 'a.ts'))).toBeUndefined()
      expect(events).toContainEqual({ kind: 'file.changed', filePath: 'a.ts' })
    } finally {
      off()
      stop()
    }
  })

  it('fails a quickfix.apply for an unknown title with the stable code', async () => {
    const uri = pathToFileURL(join(workspace, 'a.ts')).href
    const { runner } = fakeRunner({
      codeActions: { kind: 'codeActions', items: [{ title: 'Fix alpha', edits: { [uri]: [] } }] },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'nope' } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_UNKNOWN')
    } finally {
      stop()
    }
  })

  it('runs format through the official write path and reports the applied diff', async () => {
    const { runner } = fakeRunner({
      formatDocument: { kind: 'edits', edits: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: '\t' }] },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'format', requestId: 'f1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('succeeded')
      expect(result.result).toMatchObject({ kind: 'formatted', filePath: 'a.ts', appliedEdits: 1, linesChanged: 1, before: 'alpha\n    beta\ngamma\n', after: 'alpha\n\tbeta\ngamma\n' })
      expect(await readFile(join(workspace, 'a.ts'), 'utf8')).toBe('alpha\n\tbeta\ngamma\n')
    } finally {
      stop()
    }
  })

  it('reports format as unchanged when the server returns no edits', async () => {
    const { runner } = fakeRunner({ formatDocument: { kind: 'edits', edits: [] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'format', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.result).toEqual({ kind: 'unchanged', filePath: 'a.ts' })
    } finally {
      stop()
    }
  })

  it('refuses a write action under a read-only permission preset before any server round-trip', async () => {
    await disposeFakeContext(fake)
    fake = await createFakeContext({
      cwd: process.cwd(),
      fsOptions: { sandboxMode: 'read-only' },
      services: { sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) } },
    })
    workspace = join(fake.fs.root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'alpha\n')
    const { runner, calls } = fakeRunner({ formatDocument: { kind: 'edits', edits: [] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'format', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_READ_ONLY')
      expect(calls).toEqual([])
    } finally {
      stop()
    }
  })

  it('refuses a quickfix escalation without a live agent with the stable approval code', async () => {
    await disposeFakeContext(fake)
    fake = await createFakeContext({
      cwd: process.cwd(),
      fsOptions: { sandboxMode: 'workspace-write' },
      services: {
        sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
        approval: { request: async () => 'allowed-once' },
      },
    })
    workspace = join(fake.fs.root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'alpha\n')
    const { runner, calls } = fakeRunner({ codeActions: { kind: 'codeActions', items: [] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({
        action: 'quickfix.apply',
        params: { filePath: 'a.ts', workspaceRoot: workspace, sandbox_permissions: 'danger-full-access', justification: 'needed for the fix' },
      })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_APPROVAL_UNAVAILABLE')
      expect(calls).toEqual([])
    } finally {
      stop()
    }
  })

  it('times a run out through the configured editor.requestTimeoutMs', async () => {
    const runner = signalHonoringRunner()
    const { service, stop } = await assembleService(fake, { ...CONFIG, editor: { ...CONFIG.editor, requestTimeoutMs: 40 } }, runner)
    try {
      const started = Date.now()
      const result = await service.run({ action: 'diagnostics.get', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_UNAVAILABLE')
      expect(result.error?.message).toMatch(/timed out after 40 ms/)
      expect(Date.now() - started).toBeLessThan(2_000)
    } finally {
      stop()
    }
  })

  it('invalidates the cached diagnostics when the filesystem observes a new version', async () => {
    const { runner } = fakeRunner({ diagnostics: { kind: 'diagnostics', diagnostics: [
      { severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'e' },
    ] } })
    const { service, cache, stop } = await assembleService(fake, CONFIG, runner)
    try {
      await service.run({ action: 'diagnostics.get', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      const key = join(workspace, 'a.ts')
      expect(cache.get(key)).toBeDefined()
      fake.ctx.emit('fs/observed', { displayPath: key }, { kind: 'present', version: 'v2' }, undefined)
      expect(cache.get(key)).toBeUndefined()
    } finally {
      stop()
    }
  })
})

describe('editor protocol over JSON-RPC (full diagnostics → quickfix → format chain)', () => {
  let fake: FakeContext
  let workspace: string
  let input: PassThrough
  let output: PassThrough
  let frames: FrameQueue
  let server: EditorJsonRpcServer
  let service: EditorActionService
  let stop: () => void
  let client: LspActionClient

  beforeEach(async () => {
    fake = await createFakeContext({ cwd: process.cwd() })
    workspace = join(fake.fs.root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'alpha\nx abcd\n    beta\ngamma\n')
    input = new PassThrough()
    output = new PassThrough()
    frames = new FrameQueue(output)
    const servers = await resolveServers(fake.ctx as never, { fixture: fullServerEntry(process.execPath, { '.ts': 'typescript' }, [FIXTURE]) } as never)
    const sandbox = new FormatSandboxController(fake.ctx as never)
    client = new LspActionClient(fake.ctx.subprocess as never, fake.ctx.fs as never, CONFIG.maxDocumentBytes)
    const runner = createActionRunner({ getSeam: () => fake.ctx.get('lsp') as never, client, servers })
    const cache = new LruDiagnosticsCache(CONFIG.editor.diagnosticsCacheMaxFiles)
    service = new EditorActionService(fake.ctx as never, runner, sandbox, CONFIG, cache)
    stop = service.start()
    server = new EditorJsonRpcServer(service, { input, output })
    server.start()
  })

  afterEach(async () => {
    server.close()
    stop()
    await client.disposeAll()
    await disposeFakeContext(fake)
  })

  it('serves list → diagnostics → quickfix → format over JSON-RPC frames with lsp.event notifications', async () => {
    const listId = send(input, 'lsp.actions.list', {})
    const list = await frames.next(listId)
    expect(list.result).toMatchObject({ protocol: 'lsp-actions/v1', version: 1 })
    expect((list.result as { actions: unknown[] }).actions.map((entry: { action: string }) => entry.action)).toEqual([
      'diagnostics.get', 'completion.get', 'quickfix.apply', 'format',
    ])
    // Subscribe to the event stream, then run the full chain.
    notify(input, 'lsp.events', { subscribe: true })

    const diagId = send(input, 'lsp.actions.run', { action: 'diagnostics.get', requestId: 'd1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
    const diag = await frames.next(diagId)
    expect(diag.result).toMatchObject({ requestId: 'd1', action: 'diagnostics.get', status: 'succeeded' })
    const diagResult = (diag.result as { result: { kind: string; diagnostics: Array<{ severity: number; message: string }> } }).result
    expect(diagResult.kind).toBe('diagnostics')
    expect(diagResult.diagnostics.map(entry => entry.message)).toEqual(['fixture error', 'fixture warning', 'fixture info'])

    const quickfixId = send(input, 'lsp.actions.run', { action: 'quickfix.apply', requestId: 'q1', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix fixture error' } })
    const quickfix = await frames.next(quickfixId)
    expect(quickfix.result).toMatchObject({ requestId: 'q1', action: 'quickfix.apply', status: 'succeeded' })
    expect((quickfix.result as { result: unknown }).result).toMatchObject({ kind: 'quickfixApplied', title: 'Fix fixture error', filesChanged: 1 })
    expect(await readFile(join(workspace, 'a.ts'), 'utf8')).toBe('alpha\nxfixedbcd\n    beta\ngamma\n')

    const formatId = send(input, 'lsp.actions.run', { action: 'format', requestId: 'f1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
    const format = await frames.next(formatId)
    expect(format.result).toMatchObject({ requestId: 'f1', action: 'format', status: 'succeeded' })
    expect((format.result as { result: { kind: string } }).result.kind).toBe('formatted')
    expect(await readFile(join(workspace, 'a.ts'), 'utf8')).toBe('alpha\nxfixedbcd\n\tbeta\ngamma\n')

    // The event stream carried the diagnostics update and the lifecycle statuses.
    const events = await frames.drainEvents()
    const kinds = events.map(event => (event as { method: string; params: { kind: string } }).method === 'lsp.event'
      ? (event as { params: { kind: string } }).params.kind
      : undefined)
    expect(kinds).toContain('diagnostics.updated')
    expect(kinds).toContain('file.changed')
    expect(kinds).toContain('action.status')
  })

  it('answers unknown methods with -32601 and keeps serving', async () => {
    const id = send(input, 'lsp.actions.nope', {})
    const frame = await frames.next(id)
    expect(frame.error).toMatchObject({ code: -32601 })
    const listId = send(input, 'lsp.actions.list', {})
    expect((await frames.next(listId)).result).toBeDefined()
  })

  it('unsubscribing via lsp.events stops the event stream', async () => {
    notify(input, 'lsp.events', { subscribe: true })
    const id = send(input, 'lsp.actions.run', { action: 'diagnostics.get', requestId: 'd1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
    await frames.next(id)
    expect(await frames.drainEvents(100)).not.toEqual([])
    notify(input, 'lsp.events', { subscribe: false })
    const id2 = send(input, 'lsp.actions.run', { action: 'diagnostics.get', requestId: 'd2', params: { filePath: 'a.ts', workspaceRoot: workspace } })
    await frames.next(id2)
    expect(await frames.drainEvents(100)).toEqual([])
  })

  it('ignores notifications for methods other than lsp.events', async () => {
    notify(input, 'lsp.something-else', {})
    const id = send(input, 'lsp.actions.list', {})
    expect((await frames.next(id)).result).toBeDefined()
  })

  it('subscribes to the event stream by default when subscribe is absent', async () => {
    notify(input, 'lsp.events', {})
    const id = send(input, 'lsp.actions.run', { action: 'diagnostics.get', requestId: 'd9', params: { filePath: 'a.ts', workspaceRoot: workspace } })
    await frames.next(id)
    expect(await frames.drainEvents(100)).not.toEqual([])
  })

  it('defaults to process stdio when no streams are supplied', () => {
    const defaultServer = new EditorJsonRpcServer(service)
    defaultServer.close()
  })
})

/** A runner whose every op honors the abort signal by rejecting with its reason (like the client). */
function signalHonoringRunner(): ActionRunner {
  const hang = async (request: RunnerRequest, signal?: AbortSignal): Promise<never> => {
    void request
    await new Promise((_, reject) => {
      if (signal === undefined || signal.aborted) {
        reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
        return
      }
      signal.addEventListener('abort', () => { reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')) }, { once: true })
    })
    throw new Error('unreachable')
  }
  return {
    diagnostics: (request, signal) => hang(request, signal),
    formatDocument: (request, signal) => hang(request, signal),
    completion: (request, signal) => hang(request, signal),
    codeActions: (request, signal) => hang(request, signal),
    workspaceSymbols: (request, signal) => hang(request, signal),
    documentSymbols: (request, signal) => hang(request, signal),
    signatureHelp: (request, signal) => hang(request, signal),
    inlayHints: (request, signal) => hang(request, signal),
    rename: (request) => hang(request),
  }
}

/** Accumulate JSON-RPC frames written to one stream and deliver them by id. */
class FrameQueue {
  private buffer = ''
  private readonly waiters = new Map<string, Array<(frame: Record<string, unknown>) => void>>()
  private events: unknown[] = []
  private consumed = 0

  constructor(readonly stream: PassThrough) {
    stream.on('data', (chunk: Buffer | string) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      this.drain()
    })
  }

  next(id: string): Promise<Record<string, unknown>> {
    return new Promise(resolve => {
      const list = this.waiters.get(id) ?? []
      list.push(resolve)
      this.waiters.set(id, list)
      this.drain()
    })
  }

  /** The events that arrived since the previous call. */
  async drainEvents(graceMs = 250): Promise<unknown[]> {
    await new Promise(resolve => setTimeout(resolve, graceMs))
    const fresh = this.events.slice(this.consumed)
    this.consumed = this.events.length
    return fresh
  }

  private drain(): void {
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      const frame = JSON.parse(line) as Record<string, unknown>
      if (typeof frame.id === 'string' && this.waiters.has(frame.id)) {
        const waiters = this.waiters.get(frame.id)
        this.waiters.delete(frame.id)
        for (const waiter of waiters ?? []) waiter(frame)
      } else {
        this.events.push(frame)
      }
    }
  }
}

function send(input: PassThrough, method: string, params: unknown): string {
  const id = `c_${Math.random().toString(36).slice(2)}`
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return id
}

function notify(input: PassThrough, method: string, params: unknown): void {
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
}

/** Rebuild the fake context with a sessions + agents service and a workspace. */
async function recreateWithSessions(): Promise<FakeContext> {
  const created = await createFakeContext({
    cwd: process.cwd(),
    services: {
      sessions: { list: () => [{ id: 's1', header: { cwd: '/ws' } }] },
      agents: { get: () => undefined },
    },
  })
  return created
}
