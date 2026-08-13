import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  maxDiagnostics: 200,
  maxCompletionItems: 20,
  maxResultChars: 16_000,
  maxDocumentBytes: 4_000_000,
  timeoutMs: 60_000,
}

describe('lsp-actions apply', () => {
  it('fills every config default through the schemastery schema', () => {
    expect(Config({})).toMatchObject({
      servers: {},
      maxDiagnostics: 200,
      maxCompletionItems: 20,
      maxResultChars: 16_000,
      maxDocumentBytes: 4_000_000,
      timeoutMs: 60_000,
    })
  })

  it('contributes nothing when servers are empty and no seam is mounted', async () => {
    await apply(fake.ctx as never, baseConfig)
    expect(fake.tools).toHaveLength(0)
  })

  it('registers the three tools when the official seam is mounted, even with empty servers', async () => {
    fake = await recreate(fake, { lsp: { query: async () => ({ kind: 'diagnostics', diagnostics: [] }) } })
    await apply(fake.ctx as never, baseConfig)
    expect(fake.tools.map(tool => tool.name).sort()).toEqual(['lsp_completion', 'lsp_diagnostics', 'lsp_format'])
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
    ['maxResultChars', { maxResultChars: -1 }, /maxResultChars must be a positive integer/],
    ['maxDocumentBytes', { maxDocumentBytes: 0 }, /maxDocumentBytes must be a positive integer/],
    ['timeoutMs', { timeoutMs: 0 }, /timeoutMs must be a positive integer/],
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

  it('serves a real end-to-end diagnostics call through the assembled plugin', async () => {
    await apply(fake.ctx as never, {
      ...baseConfig,
      servers: { fixture: serverEntry(process.execPath, { '.ts': 'typescript' }, { args: [FIXTURE] }) },
    })
    expect(fake.tools.map(tool => tool.name).sort()).toEqual(['lsp_completion', 'lsp_diagnostics', 'lsp_format'])
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
})

/** Rebuild the fake context with extra services. */
async function recreate(previous: FakeContext, services: NonNullable<Parameters<typeof createFakeContext>[0]['services']>): Promise<FakeContext> {
  await disposeFakeContext(previous)
  const created = await createFakeContext({ cwd: root, services })
  workspace = join(created.fs.root, 'ws')
  await mkdir(workspace)
  await writeFile(join(workspace, 'a.ts'), 'alpha\n    beta\ngamma\n')
  return created
}
