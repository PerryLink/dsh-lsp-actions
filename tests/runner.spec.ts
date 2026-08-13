import { describe, expect, it } from 'vitest'
import { LspActionClient } from '../src/client.ts'
import { createActionRunner } from '../src/runner.ts'
import { routeFile, globToRegExp } from '../src/servers.ts'
import type { ResolvedServer, ResolvedServerEntry } from '../src/servers.ts'
import type { HostSource } from '../src/host.ts'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import { LspActionError } from '../src/vocabulary.ts'

function server(id: string, globs: string[] = [], extensions: Record<string, string> = { '.ts': 'typescript' }): ResolvedServer {
  const entry: ResolvedServerEntry = {
    command: 'node',
    extensionToLanguage: extensions,
    fileGlobs: globs,
    args: [],
    env: {},
    initializationOptions: null,
    configuration: null,
    formattingOptions: null,
    maxMessageBytes: 1_000_000,
    maxStderrBytes: 10_000,
    killGraceMs: 2_000,
    shutdownTimeoutMs: 2_000,
    diagnosticsSettleMs: 500,
  }
  return { serverId: id, entry, executable: 'node' }
}

const source: HostSource = {
  target: { targetKey: FsTargetKey('ws/a.ts'), displayPath: 'a.ts' },
  fileUrl: 'file:///ws/a.ts',
  text: 'const x = 1\n',
  version: FsVersion('v1'),
}

/** A client double whose per-op calls are recorded. */
function clientDouble() {
  const calls: string[] = []
  const client = {
    diagnostics: async () => { calls.push('diagnostics'); return { kind: 'diagnostics' as const, diagnostics: [] } },
    formatDocument: async () => { calls.push('formatDocument'); return { kind: 'edits' as const, edits: [] } },
    completion: async () => { calls.push('completion'); return { kind: 'completion' as const, items: [] } },
  } as unknown as LspActionClient
  return { client, calls }
}

const request = { filePath: 'a.ts', workspaceRoot: '/ws', source }

/** An error carrying a stable seam-style code, without depending on the seam's error class. */
const codedError = (message: string, code: string): Error => Object.assign(new Error(message), { code })

describe('createActionRunner routing', () => {
  it('serves through the seam when it succeeds', async () => {
    const { client, calls } = clientDouble()
    const runner = createActionRunner({
      seam: { query: async () => ({ kind: 'diagnostics' as const, diagnostics: [] }) },
      client,
      servers: [],
    })
    const result = await runner.diagnostics(request)
    expect(result.kind).toBe('diagnostics')
    expect(calls).toHaveLength(0)
  })

  it('falls back to the own client when the seam has no provider for the file', async () => {
    const { client, calls } = clientDouble()
    const runner = createActionRunner({
      seam: { query: async () => { throw codedError('no provider', 'LSP_UNAVAILABLE') } },
      client,
      servers: [server('ts')],
    })
    const result = await runner.diagnostics(request)
    expect(result.kind).toBe('diagnostics')
    expect(calls).toEqual(['diagnostics'])
  })

  it('falls back to the own client on a code-less legacy seam failure', async () => {
    const { client, calls } = clientDouble()
    const runner = createActionRunner({
      seam: { query: async () => { throw new Error('unreachable operation') } },
      client,
      servers: [server('ts')],
    })
    await expect(runner.completion({ ...request, position: { line: 0, character: 0 } })).resolves.toEqual({ kind: 'completion', items: [] })
    expect(calls).toEqual(['completion'])
  })

  it('fails loud as unsupported when the seam provider lacks the capability', async () => {
    const { client, calls } = clientDouble()
    const runner = createActionRunner({
      seam: { query: async () => { throw codedError('unsupported', 'LSP_UNSUPPORTED_OPERATION') } },
      client,
      servers: [server('ts')],
    })
    await expect(runner.formatDocument(request)).rejects.toThrow(
      expect.objectContaining({ code: 'LSP_ACTION_UNSUPPORTED' }),
    )
    expect(calls).toHaveLength(0)
  })

  it('rethrows an unrelated structured seam failure as-is', async () => {
    const { client, calls } = clientDouble()
    const failure = new LspActionError('malformed', 'LSP_ACTION_MALFORMED_RESPONSE')
    const runner = createActionRunner({
      seam: { query: async () => { throw failure } },
      client,
      servers: [],
    })
    await expect(runner.diagnostics(request)).rejects.toBe(failure)
    expect(calls).toHaveLength(0)
  })

  it('fails as unavailable when neither seam nor servers handle the file', async () => {
    const { client, calls } = clientDouble()
    const runner = createActionRunner({ seam: undefined, client, servers: [] })
    await expect(runner.diagnostics(request)).rejects.toThrow(
      expect.objectContaining({ code: 'LSP_ACTION_UNAVAILABLE' }),
    )
    await expect(runner.diagnostics(request)).rejects.toThrow(/no LSP server is configured for files with the "\.ts" extension/)
    expect(calls).toHaveLength(0)
  })
})

describe('routeFile', () => {
  it('prefers a matching glob over the extension map', () => {
    const servers = [server('ext', [], { '.ts': 'typescript' }), server('glob', ['src/**/*.ts'], { '.js': 'javascript' })]
    expect(routeFile(servers, 'src/lib/a.ts')?.server.serverId).toBe('glob')
  })

  it('falls back to the extension map in config order', () => {
    const servers = [server('first', [], { '.ts': 'typescript' }), server('second', [], { '.ts': 'typescript2' })]
    expect(routeFile(servers, 'a.ts')?.server.serverId).toBe('first')
  })

  it('matches Windows-style paths by normalizing separators', () => {
    const servers = [server('glob', ['src/**/*.ts'], { '.js': 'javascript' })]
    expect(routeFile(servers, 'src\\lib\\a.ts')?.server.serverId).toBe('glob')
  })

  it('returns undefined when nothing handles the file', () => {
    expect(routeFile([server('ts')], 'a.py')).toBeUndefined()
  })
})

describe('globToRegExp', () => {
  it('compiles * and ** with the documented crossing rules', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/lib/a.ts')).toBe(false)
    expect(globToRegExp('src/**/*.ts').test('src/lib/a.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('x/a.ts')).toBe(false)
  })

  it('escapes regex metacharacters', () => {
    expect(globToRegExp('a+b.ts').test('a+b.ts')).toBe(true)
    expect(globToRegExp('a+b.ts').test('aab.ts')).toBe(false)
  })

  it('rejects an unbalanced bracket at compile time', () => {
    expect(() => globToRegExp('a[b.ts')).toThrow(/unbalanced/)
  })
})
