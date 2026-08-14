import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { apply } from '../src/index.ts'
import { createFakeContext, disposeFakeContext, fakeExec } from './helpers/fake-ctx.ts'
import type { FakeContext } from './helpers/fake-ctx.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/lsp-fixture-server.mjs', import.meta.url))

let fake: FakeContext
let workspace: string

const config = {
  servers: {
    fixture: {
      command: process.execPath,
      args: [FIXTURE],
      extensionToLanguage: { '.ts': 'typescript' },
      fileGlobs: [],
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
    },
  },
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

beforeEach(async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-actions-extra-')))
  fake = await createFakeContext({ cwd: root })
  workspace = join(fake.fs.root, 'ws')
  await mkdir(workspace)
  await writeFile(join(workspace, 'a.ts'), 'alpha\n    beta\ngamma\n')
  await apply(fake.ctx as never, config)
})

afterEach(async () => {
  await Promise.all(fake.disposers.map(disposer => disposer()))
  await disposeFakeContext(fake)
})

function tool(name: string) {
  const found = fake.tools.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`${name} was not registered`)
  return found
}

describe('lsp_code_action against the fixture server', () => {
  it('reports reference-only quickfix edits and command forms without applying anything', async () => {
    const value = await tool('lsp_code_action').execute({ file_path: 'a.ts' }, fakeExec(workspace)) as {
      kind: string
      items: Array<{ title: string; kind?: string; isPreferred?: boolean; edits?: Array<{ uri: string; edits: Array<{ newText: string }> }>; command?: { command: string } }>
    }
    expect(value.kind).toBe('codeActions')
    expect(value.items[0]).toMatchObject({ title: 'Fix fixture error', kind: 'quickfix', isPreferred: true })
    expect(value.items[0]?.edits?.[0]?.edits[0]?.newText).toBe('fixed')
    expect(value.items[1]?.command?.command).toBe('fixture.run')
    // The reference-only framing is model-visible.
    const blocks = tool('lsp_code_action').output.render({ file_path: 'a.ts' }, value)
    const text = blocks.map(block => (block as { text: string }).text).join('\n')
    expect(text).toContain('reference only — nothing was applied')
    expect(text).toContain('fixed')
    // Nothing on disk changed.
    expect(await readFile(join(workspace, 'a.ts'), 'utf8')).toBe('alpha\n    beta\ngamma\n')
  })

  it('rejects a missing file_path', async () => {
    await expect(tool('lsp_code_action').execute({ file_path: ' ' }, fakeExec(workspace))).rejects.toThrow(/non-empty/)
  })

  it('passes only-kind filters and projects commands without arguments', async () => {
    const value = await tool('lsp_code_action').execute({ file_path: 'a.ts', only: ['quickfix'] }, fakeExec(workspace)) as {
      items: Array<{ command?: { command: string; arguments?: unknown[] } }>
    }
    expect(value.items.length).toBeGreaterThan(0)
    const bare = value.items.find(item => item.command?.command === 'fixture.bare')
    expect(bare?.command?.arguments).toBeUndefined()
  })

  it('forwards an explicit range and projects minimal action metadata', async () => {
    const value = await tool('lsp_code_action').execute({
      file_path: 'a.ts',
      range: { start: { line: 1, character: 1 }, end: { line: 2, character: 1 } },
    }, fakeExec(workspace)) as { kind: string; range?: { start: { line: number } }; items: unknown[] }
    expect(value.kind).toBe('codeActions')
    expect(value.range?.start.line).toBe(1)
    expect(tool('lsp_code_action').output.presentationMeta({}, {
      kind: 'codeActions', file_path: 'a.ts', items: [{ title: 'Bare' }],
    })).toEqual({ items: [{ title: 'Bare' }] })
  })
})

describe('lsp_symbols against the fixture server', () => {
  it('searches workspace symbols by query', async () => {
    const value = await tool('lsp_symbols').execute({ query: 'fixtureSymbol' }, fakeExec(workspace)) as {
      kind: string
      items: Array<{ name: string; kind: number; location: { uri: string } }>
    }
    expect(value.kind).toBe('symbols')
    expect(value.items).toHaveLength(1)
    expect(value.items[0]?.name).toBe('fixtureSymbol')
    expect(value.items[0]?.location.uri).toBe('file:///ws/a.ts')
  })

  it('lists document symbols when only file_path is given, flattening the hierarchy', async () => {
    const value = await tool('lsp_symbols').execute({ file_path: 'a.ts' }, fakeExec(workspace)) as {
      kind: string
      items: Array<{ name: string }>
    }
    expect(value.kind).toBe('symbols')
    expect(value.items.map(item => item.name)).toEqual(['fixtureDocumentSymbol', 'child'])
  })

  it('requires a query or a file_path', async () => {
    await expect(tool('lsp_symbols').execute({}, fakeExec(workspace))).rejects.toThrow(/requires a non-empty query or file_path/)
  })
})

describe('lsp_signature against the fixture server', () => {
  it('reports signatures with parameters and documentation at a cursor', async () => {
    const value = await tool('lsp_signature').execute({ file_path: 'a.ts', line: 1, character: 3 }, fakeExec(workspace)) as {
      kind: string
      signatures: Array<{ label: string; documentation?: string; parameters?: Array<{ label: string }> }>
      activeSignature: number
      activeParameter: number
    }
    expect(value.kind).toBe('signatures')
    expect(value.signatures[0]?.label).toBe('fixture(a: number)')
    expect(value.signatures[0]?.parameters?.[0]?.label).toBe('a: number')
    expect(value.signatures[0]?.documentation).toBe('fixture docs')
    expect(value.activeSignature).toBe(0)
    expect(value.activeParameter).toBe(0)
  })
})

describe('lsp_inlay_hints against the fixture server', () => {
  it('reports joined multi-part labels with kinds', async () => {
    const value = await tool('lsp_inlay_hints').execute({ file_path: 'a.ts' }, fakeExec(workspace)) as {
      kind: string
      items: Array<{ label: string; kind?: number; position: { line: number; character: number } }>
    }
    expect(value.kind).toBe('inlayHints')
    expect(value.items[0]?.label).toBe(': number')
    expect(value.items[0]?.kind).toBe(1)
    expect(value.items[0]?.position.line).toBe(1)
  })

  it('forwards a one-based range as a zero-based wire range', async () => {
    const value = await tool('lsp_inlay_hints').execute({
      file_path: 'a.ts',
      range: { start: { line: 1, character: 1 }, end: { line: 3, character: 1 } },
    }, fakeExec(workspace)) as { kind: string; items: unknown[] }
    expect(value.kind).toBe('inlayHints')
    expect(value.items.length).toBeGreaterThan(0)
  })

  it('rejects a range whose end precedes its start', async () => {
    await expect(tool('lsp_inlay_hints').execute({
      file_path: 'a.ts',
      range: { start: { line: 2, character: 1 }, end: { line: 1, character: 1 } },
    }, fakeExec(workspace))).rejects.toThrow(/must not precede/)
  })
})

describe('extended-tool presentation projections', () => {
  it('projects code action, symbol, signature, and inlay metadata', () => {
    expect(tool('lsp_code_action').output.presentationMeta({}, {
      kind: 'codeActions', file_path: 'a.ts', items: [{ title: 'Fix', kind: 'quickfix', isPreferred: true }],
    })).toEqual({ items: [{ title: 'Fix', kind: 'quickfix', isPreferred: true }] })

    expect(tool('lsp_symbols').output.presentationMeta({}, {
      kind: 'symbols', items: [{ name: 's', kind: 12, location: { uri: 'u', range: { start: { line: 0, character: 0 } } } }],
    })).toEqual({ items: [{ name: 's', kind: 12, location: { uri: 'u', line: 1, character: 1 } }] })

    expect(tool('lsp_signature').output.presentationMeta({}, {
      kind: 'signatures', file_path: 'a.ts', signatures: [{ label: 'f()', documentation: 'd' }, { label: 'g()' }],
    })).toEqual({ signatures: [{ label: 'f()', documentation: 'd' }, { label: 'g()' }] })

    expect(tool('lsp_inlay_hints').output.presentationMeta({}, {
      kind: 'inlayHints', file_path: 'a.ts', items: [{ position: { line: 1, character: 0 }, label: ': number' }],
    })).toEqual({ items: [{ line: 2, character: 1, label: ': number' }] })
  })
})

describe('lsp_signature without active markers', () => {
  it('omits the active fields when the server sent none', async () => {
    const { registerSignatureTool } = await import('../src/extra-tools.ts')
    const runner = {
      diagnostics: async () => { throw new Error('unexpected') },
      formatDocument: async () => { throw new Error('unexpected') },
      completion: async () => { throw new Error('unexpected') },
      codeActions: async () => { throw new Error('unexpected') },
      workspaceSymbols: async () => { throw new Error('unexpected') },
      documentSymbols: async () => { throw new Error('unexpected') },
      inlayHints: async () => { throw new Error('unexpected') },
      signatureHelp: async () => ({ kind: 'signatures', signatures: [{ label: 'f()' }] }),
    }
    registerSignatureTool(fake.ctx as never, runner as never, config as never)
    const registered = fake.tools[fake.tools.length - 1]
    if (registered === undefined) throw new Error('tool was not registered')
    const value = await registered.execute({ file_path: 'a.ts', line: 1, character: 1 }, fakeExec(workspace)) as {
      kind: string
      signatures: Array<{ label: string }>
      activeSignature?: number
      activeParameter?: number
    }
    expect(value.kind).toBe('signatures')
    expect(value.signatures[0]?.label).toBe('f()')
    expect(value.activeSignature).toBeUndefined()
    expect(value.activeParameter).toBeUndefined()
  })
})
