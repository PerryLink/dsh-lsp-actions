import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { apply, Config } from '../src/index.ts'
import type { LspServerEntry } from '../src/index.ts'
import { createFakeContext, disposeFakeContext, fakeExec } from './helpers/fake-ctx.ts'
import type { FakeContext } from './helpers/fake-ctx.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/lsp-fixture-server.mjs', import.meta.url))

/** A fully-defaulted server entry, matching what the schemastery loader hands apply(). */
function serverEntry(command: string, extensionToLanguage: Record<string, string>, overrides: Partial<LspServerEntry> = {}): LspServerEntry {
  return {
    command,
    extensionToLanguage,
    fileGlobs: [],
    args: [],
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
    ...overrides,
  }
}

let root: string
let fake: FakeContext
let workspace: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-actions-apply-')))
  fake = await createFakeContext({ cwd: root })
  workspace = join(fake.fs.root, 'ws')
  await mkdir(workspace)
  await writeFile(join(workspace, 'a.ts'), 'alpha\n    beta\ngamma\n')
})

afterEach(async () => {
  await disposeFakeContext(fake)
  await rm(root, { recursive: true, force: true })
})

const baseConfig = {
  servers: {},
  editor: { enabled: false, requestTimeoutMs: 60_000, diagnosticsCacheMaxFiles: 64 },
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

/** The full eight-tool surface, sorted. */
const ALL_TOOLS = ['lsp_code_action', 'lsp_completion', 'lsp_diagnostics', 'lsp_format', 'lsp_inlay_hints', 'lsp_rename', 'lsp_signature', 'lsp_symbols'].sort()

describe('lsp-actions apply', () => {
  it('fills every config default through the schemastery schema', () => {
    expect(Config({})).toMatchObject({
      servers: {},
      editor: { enabled: false, requestTimeoutMs: 60_000, diagnosticsCacheMaxFiles: 64 },
      maxDiagnostics: 200,
      maxCompletionItems: 20,
      maxCodeActions: 50,
      maxSymbols: 100,
      maxSignatures: 10,
      maxInlayHints: 200,
      maxResultChars: 16_000,
      maxDocumentBytes: 4_000_000,
      timeoutMs: 60_000,
    })
  })

  it('registers all eight tools even with empty servers and no seam; calls fail loudly as unavailable', async () => {
    await apply(fake.ctx as never, baseConfig)
    expect(fake.tools.map(tool => tool.name).sort()).toEqual(ALL_TOOLS)
    const tool = fake.tools.find(candidate => candidate.name === 'lsp_diagnostics')
    if (tool === undefined) throw new Error('lsp_diagnostics was not registered')
    await expect(tool.execute({ file_path: 'a.ts' }, fakeExec(workspace))).rejects.toThrow(
      expect.objectContaining({ code: 'LSP_ACTION_UNAVAILABLE' }),
    )
  })

  it('registers all eight tools when the official seam is mounted, even with empty servers', async () => {
    fake = await recreate(fake, { lsp: { query: async () => ({ kind: 'diagnostics', diagnostics: [] }) } })
    await apply(fake.ctx as never, baseConfig)
    expect(fake.tools.map(tool => tool.name).sort()).toEqual(ALL_TOOLS)
  })

  it('serves through a seam mounted after this plugin (lazy per-call seam resolution)', async () => {
    const services: NonNullable<Parameters<typeof createFakeContext>[0]['services']> = {}
    fake = await recreate(fake, services)
    await apply(fake.ctx as never, baseConfig)
    // The seam appears after apply; the next call must route through it without a reload.
    services.lsp = { query: async () => ({ kind: 'completion', items: [{ label: 'lazy' }] }) }
    const tool = fake.tools.find(candidate => candidate.name === 'lsp_completion')
    if (tool === undefined) throw new Error('lsp_completion was not registered')
    const value = await tool.execute({ file_path: 'a.ts', line: 1, character: 1 }, fakeExec(workspace)) as { kind: string }
    expect(value.kind).toBe('completion')
    await Promise.all(fake.disposers.map(disposer => disposer()))
  })

  it('fails at load when a configured command does not exist', async () => {
    await expect(apply(fake.ctx as never, {
      ...baseConfig,
      servers: { broken: serverEntry('dsh-command-that-does-not-exist-xyz', { '.ts': 'typescript' }) },
    })).rejects.toThrow(/was not found on PATH/)
    expect(fake.tools).toHaveLength(0)
  })

  it.each([
    ['maxDiagnostics', { maxDiagnostics: 0 }, /maxDiagnostics must be a positive integer/],
    ['maxCompletionItems', { maxCompletionItems: 0 }, /maxCompletionItems must be a positive integer/],
    ['maxCodeActions', { maxCodeActions: 0 }, /maxCodeActions must be a positive integer/],
    ['maxSymbols', { maxSymbols: 0 }, /maxSymbols must be a positive integer/],
    ['maxSignatures', { maxSignatures: 0 }, /maxSignatures must be a positive integer/],
    ['maxInlayHints', { maxInlayHints: 0 }, /maxInlayHints must be a positive integer/],
    ['maxResultChars', { maxResultChars: -1 }, /maxResultChars must be a positive integer/],
    ['maxDocumentBytes', { maxDocumentBytes: 0 }, /maxDocumentBytes must be a positive integer/],
    ['timeoutMs', { timeoutMs: 0 }, /timeoutMs must be a positive integer/],
    ['editor.diagnosticsCacheMaxFiles', { editor: { enabled: false, requestTimeoutMs: 60_000, diagnosticsCacheMaxFiles: 0 } }, /editor\.diagnosticsCacheMaxFiles must be a positive integer/],
    ['editor.requestTimeoutMs', { editor: { enabled: false, requestTimeoutMs: 0, diagnosticsCacheMaxFiles: 64 } }, /editor\.requestTimeoutMs must be a positive integer/],
  ])('rejects an invalid %s at load', async (_name, patch, pattern) => {
    await expect(apply(fake.ctx as never, { ...baseConfig, ...patch })).rejects.toThrow(pattern)
  })

  it('rejects an invalid server bound at load', async () => {
    await expect(apply(fake.ctx as never, {
      ...baseConfig,
      servers: { bad: serverEntry(process.execPath, { '.ts': 'typescript' }, { diagnosticsSettleMs: 0 }) },
    })).rejects.toThrow(/servers\.bad\.diagnosticsSettleMs must be a positive integer/)
  })

  it('rejects a server entry mapping no extensions at load', async () => {
    await expect(apply(fake.ctx as never, {
      ...baseConfig,
      servers: { empty: serverEntry(process.execPath, {}) },
    })).rejects.toThrow(/must map at least one extension/)
  })

  it('rejects a server entry with an empty id at load', async () => {
    await expect(apply(fake.ctx as never, {
      ...baseConfig,
      servers: { '': serverEntry(process.execPath, { '.ts': 'typescript' }) },
    })).rejects.toThrow(/server ids must be non-empty/)
  })

  it('rejects a server entry mapping an invalid extension at load', async () => {
    await expect(apply(fake.ctx as never, {
      ...baseConfig,
      servers: { bad: serverEntry(process.execPath, { 'ts/x': 'typescript' }) },
    })).rejects.toThrow(/maps an invalid extension/)
  })

  it('rejects a server entry mapping an extension to an empty language id at load', async () => {
    await expect(apply(fake.ctx as never, {
      ...baseConfig,
      servers: { bad: serverEntry(process.execPath, { '.ts': '' }) },
    })).rejects.toThrow(/empty language id/)
  })

  it('serves a real end-to-end diagnostics call through the assembled plugin', async () => {
    await apply(fake.ctx as never, {
      ...baseConfig,
      servers: { fixture: serverEntry(process.execPath, { '.ts': 'typescript' }, { args: [FIXTURE] }) },
    })
    expect(fake.tools.map(tool => tool.name).sort()).toEqual(ALL_TOOLS)
    const tool = fake.tools.find(candidate => candidate.name === 'lsp_diagnostics')
    if (tool === undefined) throw new Error('lsp_diagnostics was not registered')
    const value = await tool.execute({ file_path: 'a.ts' }, fakeExec(workspace)) as {
      kind: string
      diagnostics: Array<{ severity: number; message: string }>
    }
    expect(value.kind).toBe('diagnostics')
    expect(value.diagnostics).toHaveLength(3)
    expect(value.diagnostics[0]?.severity).toBe(1)
    expect(value.diagnostics[0]?.message).toBe('fixture error')
    await Promise.all(fake.disposers.map(disposer => disposer()))
  })

  it('serves the editor protocol over the injected transport when editor.enabled is true, reversibly', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const received: string[] = []
    output.on('data', (chunk: Buffer) => { received.push(chunk.toString('utf8')) })
    await apply(fake.ctx as never, {
      ...baseConfig,
      editor: { enabled: true, requestTimeoutMs: 60_000, diagnosticsCacheMaxFiles: 4, input, output },
    } as never)
    expect(fake.tools.map(tool => tool.name).sort()).toEqual(ALL_TOOLS)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 't1', method: 'lsp.actions.list', params: {} })}\n`)
    await waitFor(() => received.some(line => line.includes('"protocol":"lsp-actions/v1"')))
    // Disposal reverses the surface: the transport detaches and no further responses arrive.
    await Promise.all(fake.disposers.map(disposer => disposer()))
    received.length = 0
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 't2', method: 'lsp.actions.list', params: {} })}\n`)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(received).toEqual([])
  })
})

/** Poll until the predicate holds, failing after the budget. */
async function waitFor(predicate: () => boolean, budgetMs = 2_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > budgetMs) throw new Error('condition did not hold in time')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Rebuild the fake context with extra services. */
async function recreate(previous: FakeContext, services: NonNullable<Parameters<typeof createFakeContext>[0]['services']>): Promise<FakeContext> {
  await disposeFakeContext(previous)
  const created = await createFakeContext({ cwd: root, services })
  workspace = join(created.fs.root, 'ws')
  await mkdir(workspace)
  await writeFile(join(workspace, 'a.ts'), 'alpha\n    beta\ngamma\n')
  return created
}
