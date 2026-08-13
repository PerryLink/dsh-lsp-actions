import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
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

/** A resolved server entry pointing at the fixture with the given flags. */
function fixtureServer(flags: string[] = []): ResolvedServer {
  const entry: ResolvedServerEntry = {
    command: process.execPath,
    extensionToLanguage: { '.ts': 'typescript' },
    fileGlobs: [],
    args: [FIXTURE, ...flags],
    env: {},
    initializationOptions: null,
    configuration: null,
    formattingOptions: null,
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 1_000_000,
    killGraceMs: 2_000,
    shutdownTimeoutMs: 2_000,
    diagnosticsSettleMs: 500,
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
