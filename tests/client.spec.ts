import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { LspActionClient } from '../src/client.ts'
import { canonicalizeWorkspace, readHostSource } from '../src/host.ts'
import type { ResolvedServer, ResolvedServerEntry } from '../src/servers.ts'
import { FakeFs } from './helpers/fake-ctx.ts'
import { spawnForTest } from './helpers/spawn-adapter.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/lsp-fixture-server.mjs', import.meta.url))

let root: string
let fs: FakeFs
let workspace: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-actions-client-')))
  workspace = join(root, 'ws')
  await mkdir(workspace)
  await writeFile(join(workspace, 'a.ts'), 'alpha\n    beta\ngamma\n')
  fs = new FakeFs(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A resolved server entry pointing at the fixture with the given flags and static configuration. */
function fixtureServer(
  flags: string[] = [],
  configuration: unknown = null,
  overrides: Partial<ResolvedServerEntry> = {},
): ResolvedServer {
  const entry: ResolvedServerEntry = {
    command: process.execPath,
    extensionToLanguage: { '.ts': 'typescript' },
    fileGlobs: [],
    args: [FIXTURE, ...flags],
    env: {},
    initializationOptions: null,
    configuration,
    formattingOptions: null,
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 1_000_000,
    killGraceMs: 2_000,
    shutdownTimeoutMs: 2_000,
    diagnosticsSettleMs: 500,
    diagnosticsDebounceMs: 100,
    idleTimeoutMs: 0,
    ...overrides,
  }
  return { serverId: 'fixture', entry, executable: process.execPath }
}

async function prepare(client: LspActionClient, server: ResolvedServer) {
  const workspaceRoot = workspace
  const hostWorkspace = await canonicalizeWorkspace(fs, workspaceRoot)
  const source = await readHostSource(fs, 'a.ts', hostWorkspace, 4_000_000)
  return {
    request: { filePath: 'a.ts', workspaceRoot, source, languageId: 'typescript' },
    client,
    server,
  }
}

function makeClient(): LspActionClient {
  // The client only uses `spawn`; the seam type carries resolveExecutable, which tests never reach.
  const subprocess = { spawn: (spec: never) => spawnForTest(spec), resolveExecutable: async (command: string) => command } as never
  return new LspActionClient(subprocess, fs as never)
}

describe('LspActionClient against the fixture server', () => {
  it('serves pull diagnostics with severities, ranges, and sources', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer())
    try {
      const result = await client.diagnostics(server, request)
      expect(result.kind).toBe('diagnostics')
      expect(result.diagnostics).toHaveLength(3)
      expect(result.diagnostics[0]).toEqual({
        severity: 1,
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } },
        message: 'fixture error',
        source: 'fixture',
        code: 42,
      })
      expect(result.diagnostics[2]?.severity).toBe(3)
    } finally {
      await client.disposeAll()
    }
  })

  it('serves push-only diagnostics through the open→push→settle path', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--push-diag']))
    try {
      const result = await client.diagnostics(server, request)
      expect(result.diagnostics).toHaveLength(3)
      expect(result.diagnostics[1]?.message).toBe('fixture warning')
    } finally {
      await client.disposeAll()
    }
  })

  it('returns the latest pushed batch after a partial-then-complete push, not the first', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--multi-push']))
    try {
      const result = await client.diagnostics(server, request)
      expect(result.diagnostics).toHaveLength(3)
      expect(result.diagnostics[1]?.message).toBe('fixture warning')
    } finally {
      await client.disposeAll()
    }
  })

  it('rejects diagnostics on a server whose textDocumentSync excludes transient open', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--sync-none']))
    try {
      await expect(client.diagnostics(server, request)).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_UNSUPPORTED' }),
      )
    } finally {
      await client.disposeAll()
    }
  })

  it('answers workspace/configuration per section, falling back to the whole value', async () => {
    const client = makeClient()
    const configuration = { typescript: { format: 'x' }, python: 'py' }
    const { request, server } = await prepare(client, fixtureServer(['--ask-config'], configuration))
    try {
      const result = await client.diagnostics(server, request)
      expect(result.diagnostics[0]?.message).toContain('[config:{"format":"x"}]')
      expect(result.diagnostics[1]?.message).toContain('[config:"py"]')
      // The unmapped section falls back to the whole static value.
      expect(result.diagnostics[2]?.message).toContain('[config:{"typescript":{"format":"x"},"python":"py"}]')
    } finally {
      await client.disposeAll()
    }
  })

  it('retries a fresh spawn once when the first instance dies during handshake', async () => {
    const client = makeClient()
    const marker = join(root, 'retry-marker')
    const { request, server } = await prepare(client, fixtureServer(['--fail-first-time', marker]))
    try {
      const result = await client.diagnostics(server, request)
      expect(result.diagnostics).toHaveLength(3)
    } finally {
      await client.disposeAll()
    }
  })

  it('evicts an idle instance after idleTimeoutMs and spawns fresh for the next call', async () => {
    const client = makeClient()
    const marker = join(root, 'spawn-count.txt')
    const { request, server } = await prepare(client, fixtureServer(['--count-spawns', marker], null, { idleTimeoutMs: 60 }))
    try {
      const first = await client.diagnostics(server, request)
      expect(first.diagnostics).toHaveLength(3)
      await new Promise(resolve => setTimeout(resolve, 250))
      const second = await client.diagnostics(server, request)
      expect(second.diagnostics).toHaveLength(3)
      expect((await readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(2)
    } finally {
      await client.disposeAll()
    }
  })

  it('negotiates utf-8 positions: encodes request cursors and decodes pull results', async () => {
    const client = makeClient()
    await writeFile(join(workspace, 'u.ts'), 'alpha\n😀xx\n')
    const hostWorkspace = await canonicalizeWorkspace(fs, workspace)
    const source = await readHostSource(fs, 'u.ts', hostWorkspace, 4_000_000)
    const request = { filePath: 'u.ts', workspaceRoot: workspace, source, languageId: 'typescript' }
    const server = fixtureServer(['--utf8'])
    try {
      // Server-side range characters 4..6 (utf-8 bytes, past the 4-byte emoji) decode to utf-16 2..4.
      const diagnostics = await client.diagnostics(server, request)
      expect(diagnostics.diagnostics[0]?.range).toEqual({ start: { line: 1, character: 2 }, end: { line: 1, character: 4 } })
      // The utf-16 cursor at character 3 is sent as utf-8 byte 5 and echoed back by the fixture.
      const completion = await client.completion(server, { ...request, position: { line: 1, character: 3 } })
      expect(completion.items[0]?.textEdit?.range.start.character).toBe(3)
    } finally {
      await client.disposeAll()
    }
  })

  it('decodes pushed utf-8 diagnostics through the opened document text', async () => {
    const client = makeClient()
    await writeFile(join(workspace, 'u.ts'), 'alpha\n😀xx\n')
    const hostWorkspace = await canonicalizeWorkspace(fs, workspace)
    const source = await readHostSource(fs, 'u.ts', hostWorkspace, 4_000_000)
    const request = { filePath: 'u.ts', workspaceRoot: workspace, source, languageId: 'typescript' }
    const server = fixtureServer(['--utf8', '--push-diag'])
    try {
      const diagnostics = await client.diagnostics(server, request)
      expect(diagnostics.diagnostics[0]?.range).toEqual({ start: { line: 1, character: 2 }, end: { line: 1, character: 4 } })
    } finally {
      await client.disposeAll()
    }
  })

  it('serves completion items', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer())
    try {
      const result = await client.completion(server, { ...request, position: { line: 0, character: 0 } })
      expect(result.kind).toBe('completion')
      expect(result.items.map(item => item.label)).toEqual(['alpha', 'beta'])
      expect(result.items[0]?.detail).toBe('fixture alpha')
    } finally {
      await client.disposeAll()
    }
  })

  it('serves formatting edits for the whole document', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer())
    try {
      const result = await client.formatDocument(server, request)
      expect(result.kind).toBe('edits')
      expect(result.edits).toEqual([
        { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: '\t' },
      ])
    } finally {
      await client.disposeAll()
    }
  })

  it('serves range formatting through the rangeFormatting method', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer())
    try {
      const result = await client.formatDocument(server, {
        ...request,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
      })
      expect(result.kind).toBe('edits')
      expect(result.edits).toHaveLength(1)
    } finally {
      await client.disposeAll()
    }
  })

  it('renames the word at the cursor after a prepareRename round trip', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer())
    try {
      const result = await client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')
      expect(result.kind).toBe('rename')
      const uris = Object.keys(result.edits)
      expect(uris).toHaveLength(1)
      expect(uris[0]).toContain('/a.ts')
      expect(result.edits[uris[0]]).toEqual([
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'newName' },
      ])
    } finally {
      await client.disposeAll()
    }
  })

  it('fails as no-symbol when prepareRename answers null', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--no-rename-symbol']))
    try {
      await expect(client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_NO_SYMBOL' }),
      )
    } finally {
      await client.disposeAll()
    }
  })

  it('serves rename when the server lacks prepareRename', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--no-prepare-rename']))
    try {
      const result = await client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')
      expect(result.kind).toBe('rename')
      expect(Object.values(result.edits)[0]?.[0]?.newText).toBe('newName')
    } finally {
      await client.disposeAll()
    }
  })

  it('decodes cross-file rename positions per document on a utf-8 server', async () => {
    const client = makeClient()
    await writeFile(join(workspace, 'other.ts'), 'éé other\n')
    const { request, server } = await prepare(client, fixtureServer(['--utf8', '--rename-multi-file']))
    try {
      const result = await client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')
      expect(result.kind).toBe('rename')
      const entries = Object.entries(result.edits)
      expect(entries).toHaveLength(2)
      const origin = entries.find(([uri]) => uri.includes('/a.ts'))
      const other = entries.find(([uri]) => uri.includes('/other.ts'))
      // The origin word is ASCII, so its utf-8 range equals the utf-16 range.
      expect(origin?.[1]).toEqual([
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'newName' },
      ])
      // 'éé other': the fixture's utf-8 bytes 5..10 decode to utf-16 characters 3..8.
      expect(other?.[1]).toEqual([
        { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 8 } }, newText: 'newName' },
      ])
    } finally {
      await client.disposeAll()
    }
  })

  it('leaves cross-file utf-16 positions untouched without reading the target', async () => {
    const client = makeClient()
    // other.ts is intentionally absent: a utf-16 server needs no target read for position decoding.
    const { request, server } = await prepare(client, fixtureServer(['--rename-multi-file']))
    try {
      const result = await client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')
      const other = Object.entries(result.edits).find(([uri]) => uri.includes('/other.ts'))
      expect(other?.[1]).toEqual([
        { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 8 } }, newText: 'newName' },
      ])
    } finally {
      await client.disposeAll()
    }
  })

  it('fails a utf-8 cross-file rename as a conflict when the target cannot be decoded', async () => {
    const client = makeClient()
    // other.ts absent: the client cannot read the target text to decode the utf-8 positions.
    const { request, server } = await prepare(client, fixtureServer(['--utf8', '--rename-multi-file']))
    try {
      await expect(client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_CONFLICT' }),
      )
      await expect(client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')).rejects.toThrow(/cannot be read/)
    } finally {
      await client.disposeAll()
    }
  })

  it('refuses file operations in a rename result', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--rename-file-ops']))
    try {
      await expect(client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_UNSUPPORTED' }),
      )
      await expect(client.rename(server, { ...request, position: { line: 0, character: 1 } }, 'newName')).rejects.toThrow(/file operation/)
    } finally {
      await client.disposeAll()
    }
  })

  it('fails a bad server startup loudly with the stderr tail', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--fail-start']))
    try {
      await expect(client.diagnostics(server, request)).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_SERVER_FAILED' }),
      )
      await expect(client.diagnostics(server, request)).rejects.toThrow(/refusing to start/)
    } finally {
      await client.disposeAll()
    }
  })

  it('rejects an action the server did not advertise', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--no-completion']))
    try {
      await expect(client.completion(server, { ...request, position: { line: 0, character: 0 } })).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_UNSUPPORTED' }),
      )
    } finally {
      await client.disposeAll()
    }
  })

  it('rejects a malformed formatting payload', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--malformed-format']))
    try {
      await expect(client.formatDocument(server, request)).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }),
      )
    } finally {
      await client.disposeAll()
    }
  })

  it('surfaces a server error response on a rejected request', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--reject-format']))
    try {
      await expect(client.formatDocument(server, request)).rejects.toThrow(/formatting refused by the fixture/)
    } finally {
      await client.disposeAll()
    }
  })

  it('answers lifecycle server requests and refuses workspace/applyEdit without breaking the stream', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--server-requests']))
    try {
      const result = await client.diagnostics(server, request)
      expect(result.diagnostics).toHaveLength(3)
    } finally {
      await client.disposeAll()
    }
  })

  it('honors an abort signal against a hanging server and still disposes cleanly', async () => {
    const client = makeClient()
    const { request, server } = await prepare(client, fixtureServer(['--hang']))
    const controller = new AbortController()
    const pending = client.completion(server, { ...request, position: { line: 0, character: 0 } }, controller.signal)
    const rejection = expect(pending).rejects.toThrow('stopped by the test')
    controller.abort(new Error('stopped by the test'))
    await rejection
    await expect(client.disposeAll()).resolves.toBeUndefined()
  })
})
