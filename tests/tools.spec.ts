import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ActionRunner, RunnerRequest } from '../src/runner.ts'
import { registerCompletionTool, registerDiagnosticsTool, registerFormatTool, registerRenameTool } from '../src/tools.ts'
import { FormatSandboxController } from '../src/sandbox.ts'
import { createFakeContext, disposeFakeContext, fakeExec } from './helpers/fake-ctx.ts'
import type { FakeContext } from './helpers/fake-ctx.ts'
import type { LspActionResult, LspDiagnostic, LspTextEdit } from '../src/vocabulary.ts'

const diagnostic = (line: number, severity: number, message: string): LspDiagnostic => ({
  severity,
  range: { start: { line, character: 0 }, end: { line, character: 4 } },
  message,
  source: 'ts',
  code: 1000 + line,
})

const edit = (line: number, oldText: string, newText: string): LspTextEdit => ({
  range: { start: { line, character: 0 }, end: { line, character: oldText.length } },
  newText,
})

/** A canned runner that records every request and answers each op from its fixed result. */
function fakeRunner(results: {
  diagnostics?: { kind: 'diagnostics'; diagnostics: LspDiagnostic[] }
  formatDocument?: { kind: 'edits'; edits: LspTextEdit[] }
  completion?: {
    kind: 'completion'
    items: { label: string; detail?: string; insertText?: string; textEdit?: LspTextEdit }[]
  }
  rename?: { kind: 'rename'; edits: Record<string, LspTextEdit[]> }
}): { runner: ActionRunner; calls: RunnerRequest[] } {
  const calls: RunnerRequest[] = []
  const unexpected = (): never => {
    throw new Error('unexpected runner result')
  }
  const runner: ActionRunner = {
    diagnostics: async (request) => {
      calls.push(request)
      if (results.diagnostics === undefined) throw new Error('unexpected runner result')
      return results.diagnostics
    },
    formatDocument: async (request) => {
      calls.push(request)
      if (results.formatDocument === undefined) throw new Error('unexpected runner result')
      return results.formatDocument
    },
    completion: async (request) => {
      calls.push(request)
      if (results.completion === undefined) throw new Error('unexpected runner result')
      return results.completion
    },
    codeActions: async (request) => {
      calls.push(request)
      return unexpected()
    },
    workspaceSymbols: async (request) => {
      calls.push(request)
      return unexpected()
    },
    documentSymbols: async (request) => {
      calls.push(request)
      return unexpected()
    },
    signatureHelp: async (request) => {
      calls.push(request)
      return unexpected()
    },
    inlayHints: async (request) => {
      calls.push(request)
      return unexpected()
    },
    rename: async (request) => {
      calls.push(request)
      if (results.rename === undefined) throw new Error('unexpected runner result')
      return results.rename
    },
  }
  return { runner, calls }
}

const CONFIG = {
  servers: {},
  maxDiagnostics: 2,
  maxCompletionItems: 2,
  maxCodeActions: 50,
  maxSymbols: 100,
  maxSignatures: 10,
  maxInlayHints: 200,
  maxResultChars: 16_000,
  maxDocumentBytes: 4_000_000,
  timeoutMs: 60_000,
}

function toolByName(fake: FakeContext, name: string): ToolDefinition {
  const tool = fake.tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`tool ${name} was not registered`)
  return tool
}

describe('lsp_diagnostics tool', () => {
  let fake: FakeContext
  let workspace: string

  beforeEach(async () => {
    fake = await createFakeContext({ cwd: process.cwd() })
    workspace = join(fake.fs.root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'const x = 1\n')
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('count-caps the canonical value and marks truncation honestly', async () => {
    const { runner } = fakeRunner({ diagnostics: { kind: 'diagnostics', diagnostics: [diagnostic(0, 1, 'e0'), diagnostic(1, 2, 'w1'), diagnostic(2, 3, 'i2')] } })
    registerDiagnosticsTool(fake.ctx as never, runner, CONFIG)
    const tool = toolByName(fake, 'lsp_diagnostics')
    const value = await tool.execute({ file_path: 'a.ts' }, fakeExec(workspace)) as {
      kind: string
      diagnostics: unknown[]
      truncated: boolean
      total: number
    }
    expect(value.kind).toBe('diagnostics')
    expect(value.diagnostics).toHaveLength(2)
    expect(value.truncated).toBe(true)
    expect(value.total).toBe(3)
  })

  it('renders severity labels and truncates the complete result by characters', async () => {
    const { runner } = fakeRunner({ diagnostics: { kind: 'diagnostics', diagnostics: [diagnostic(0, 1, 'first error'), diagnostic(1, 2, 'second warning')] } })
    // 77 chars = the 29-char first diagnostic line + the 48-char truncation notice, so the second
    // line must fall out while the first survives intact.
    registerDiagnosticsTool(fake.ctx as never, runner, { ...CONFIG, maxDiagnostics: 10, maxResultChars: 77 })
    const tool = toolByName(fake, 'lsp_diagnostics')
    const value = await tool.execute({ file_path: 'a.ts' }, fakeExec(workspace)) as { kind: string; diagnostics: unknown[] }
    const blocks = tool.output.render({ file_path: 'a.ts' }, value)
    const text = blocks.map(block => (block as { text: string }).text).join('\n')
    expect(text).toContain('[Error] first error')
    expect(text).toContain('truncated (limit 77 characters)')
    expect(text).not.toContain('second warning')
    expect(text.length).toBeLessThanOrEqual(77)
  })

  it('renders a distinct no-result line', async () => {
    const { runner } = fakeRunner({ diagnostics: { kind: 'diagnostics', diagnostics: [] } })
    registerDiagnosticsTool(fake.ctx as never, runner, CONFIG)
    const tool = toolByName(fake, 'lsp_diagnostics')
    const value = await tool.execute({ file_path: 'a.ts' }, fakeExec(workspace)) as { kind: string; diagnostics: unknown[] }
    const blocks = tool.output.render({ file_path: 'a.ts' }, value)
    expect(blocks[0]).toEqual({ type: 'text', text: `No diagnostics reported for a.ts.` })
  })

  it('fails as LSP_ACTION_WORKSPACE_REQUIRED without a session cwd', async () => {
    const { runner } = fakeRunner({})
    registerDiagnosticsTool(fake.ctx as never, runner, CONFIG)
    const tool = toolByName(fake, 'lsp_diagnostics')
    const exec = fakeExec(workspace) as { agent: unknown } & ReturnType<typeof fakeExec>
    ;(exec as { agent: unknown }).agent = undefined
    await expect(tool.execute({ file_path: 'a.ts' }, exec)).rejects.toThrow(
      expect.objectContaining({ code: 'LSP_ACTION_WORKSPACE_REQUIRED' }),
    )
  })
})

describe('lsp_completion tool', () => {
  let fake: FakeContext
  let workspace: string

  beforeEach(async () => {
    fake = await createFakeContext({ cwd: process.cwd() })
    workspace = join(fake.fs.root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'const x = 1\n')
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('converts one-based cursor input to zero-based and caps items', async () => {
    const { runner, calls } = fakeRunner({ completion: { kind: 'completion', items: [{ label: 'a', detail: 'one' }, { label: 'b', detail: 'two' }, { label: 'c', detail: 'three' }] } })
    registerCompletionTool(fake.ctx as never, runner, CONFIG)
    const tool = toolByName(fake, 'lsp_completion')
    const value = await tool.execute({ file_path: 'a.ts', line: 3, character: 7 }, fakeExec(workspace)) as {
      kind: string
      items: unknown[]
      truncated: boolean
      total: number
    }
    expect(calls[0]?.position).toEqual({ line: 2, character: 6 })
    expect(value.items).toHaveLength(2)
    expect(value.truncated).toBe(true)
    expect(value.total).toBe(3)
  })

  it('marks the rendered result as reference-only, never executed', async () => {
    const { runner } = fakeRunner({ completion: { kind: 'completion', items: [{ label: 'alpha', detail: 'fixture alpha' }] } })
    registerCompletionTool(fake.ctx as never, runner, CONFIG)
    const tool = toolByName(fake, 'lsp_completion')
    const value = await tool.execute({ file_path: 'a.ts', line: 1, character: 1 }, fakeExec(workspace)) as { kind: string; items: unknown[] }
    const blocks = tool.output.render({ file_path: 'a.ts', line: 1, character: 1 }, value)
    const text = blocks.map(block => (block as { text: string }).text).join('\n')
    expect(text).toContain('reference only — nothing was executed')
    expect(text).toContain('1. alpha — fixture alpha')
  })

  it('projects textEdit and insertText into the canonical items', async () => {
    const textEdit: LspTextEdit = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      newText: 'console.log()',
    }
    const { runner } = fakeRunner({
      completion: {
        kind: 'completion',
        items: [
          { label: 'log', textEdit },
          { label: 'plain', insertText: 'plain()' },
        ],
      },
    })
    registerCompletionTool(fake.ctx as never, runner, CONFIG)
    const tool = toolByName(fake, 'lsp_completion')
    const value = await tool.execute({ file_path: 'a.ts', line: 1, character: 1 }, fakeExec(workspace)) as {
      items: Array<{ label: string; insertText?: string; textEdit?: LspTextEdit }>
    }
    expect(value.items[0]?.textEdit).toEqual(textEdit)
    expect(value.items[1]?.insertText).toBe('plain()')
    expect(tool.output.presentationMeta({}, value)).toEqual({
      items: [
        { label: 'log', insertText: 'console.log()' },
        { label: 'plain', insertText: 'plain()' },
      ],
    })
  })
})

describe('tool presentation projections', () => {
  let fake: FakeContext

  beforeEach(async () => {
    fake = await createFakeContext({ cwd: process.cwd() })
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('projects diagnostics metadata with columns, sources, and codes', async () => {
    registerDiagnosticsTool(fake.ctx as never, fakeRunner({ diagnostics: { kind: 'diagnostics', diagnostics: [] } }).runner, CONFIG)
    const tool = toolByName(fake, 'lsp_diagnostics')
    expect(tool.output.presentationMeta({}, {
      kind: 'diagnostics',
      diagnostics: [{ severity: 2, range: { start: { line: 0, character: 1 } }, message: 'm', source: 's', code: 7 }],
    })).toEqual({ diagnostics: [{ line: 1, character: 2, severity: 2, message: 'm', source: 's', code: 7 }] })
  })

  it('projects format metadata as a diff card for both outcome kinds', async () => {
    registerFormatTool(fake.ctx as never, fakeRunner({ formatDocument: { kind: 'edits', edits: [] } }).runner, new FormatSandboxController(fake.ctx as never), CONFIG)
    const tool = toolByName(fake, 'lsp_format')
    expect(tool.output.presentationMeta({ file_path: 'a.ts' }, {
      kind: 'formatted', file_path: 'a.ts', appliedEdits: 1, linesChanged: 1, before: 'a', after: 'b',
    })).toEqual({ diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b' }] })
    expect(tool.output.presentationMeta({ file_path: 'a.ts' }, { kind: 'unchanged', file_path: 'a.ts' })).toEqual({ diffs: [] })
  })

  it('projects rename metadata as per-file diff cards for both outcome kinds', async () => {
    registerRenameTool(fake.ctx as never, fakeRunner({}).runner, new FormatSandboxController(fake.ctx as never), CONFIG)
    const tool = toolByName(fake, 'lsp_rename')
    expect(tool.output.presentationMeta({ file_path: 'a.ts', line: 1, character: 1, new_name: 'next' }, {
      kind: 'renamed', file_path: 'a.ts', new_name: 'next', filesChanged: 2, appliedEdits: 2,
      diffs: [
        { file_path: 'a.ts', before: 'a', after: 'b' },
        { file_path: 'other.ts', before: 'c', after: 'd' },
      ],
    })).toEqual({ diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b' }, { path: 'other.ts', oldText: 'c', newText: 'd' }] })
    expect(tool.output.presentationMeta({ file_path: 'a.ts', line: 1, character: 1, new_name: 'next' }, {
      kind: 'unchanged', file_path: 'a.ts', new_name: 'next',
    })).toEqual({ diffs: [] })
  })
})

describe('lsp_format permission matrix', () => {
  /** Build a fake whose workspace holds `a.ts`, with the given services and fs options. */
  async function fixture(options: {
    fsOptions?: Parameters<typeof createFakeContext>[0]['fsOptions']
    services?: Parameters<typeof createFakeContext>[0]['services']
    writeIntent?: Parameters<typeof createFakeContext>[0]['writeIntent']
  }): Promise<{ fake: FakeContext; workspace: string; filePath: string }> {
    const fake = await createFakeContext({
      cwd: process.cwd(),
      fsOptions: options.fsOptions,
      services: options.services,
      writeIntent: options.writeIntent,
    })
    const workspace = join(fake.fs.root, 'ws')
    await mkdir(workspace)
    const filePath = join(workspace, 'a.ts')
    await writeFile(filePath, 'const x = 1\n')
    return { fake, workspace, filePath }
  }

  async function teardown(fake: FakeContext): Promise<void> {
    await disposeFakeContext(fake)
  }

  it('rejects a range whose end precedes its start before any server round-trip', async () => {
    const { fake, workspace } = await fixture({})
    try {
      const { runner, calls } = fakeRunner({ formatDocument: { kind: 'edits', edits: [] } })
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      await expect(tool.execute({
        file_path: 'a.ts',
        range: { start: { line: 2, character: 1 }, end: { line: 1, character: 1 } },
      }, fakeExec(workspace))).rejects.toThrow(/must not precede/)
      expect(calls).toHaveLength(0)
    } finally {
      await teardown(fake)
    }
  })

  it('writes under workspace-write policy through write-intent and records observations', async () => {
    const { fake, workspace, filePath } = await fixture({
      fsOptions: { sandboxMode: 'workspace-write' },
      services: { sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) } },
    })
    try {
      const { runner } = fakeRunner({ formatDocument: { kind: 'edits', edits: [edit(0, 'const x = 1', 'let x = 1')] } })
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      const value = await tool.execute({ file_path: 'a.ts' }, fakeExec(workspace)) as {
        kind: string
        appliedEdits: number
        before: string
        after: string
      }
      expect(value.kind).toBe('formatted')
      expect(value.appliedEdits).toBe(1)
      expect(value.linesChanged).toBe(1)
      expect(value.before).toBe('const x = 1\n')
      expect(value.after).toBe('let x = 1\n')
      expect(await readFile(filePath, 'utf8')).toBe('let x = 1\n')
      expect(fake.writeIntents).toHaveLength(1)
      const expectedTarget = await fake.fs.resolve('a.ts', { cwd: workspace })
      expect(fake.writeIntents[0]?.target.targetKey).toBe(expectedTarget.targetKey)
      expect(fake.observed).toHaveLength(2)
      expect(fake.observed[0]?.observation.kind).toBe('present')
    } finally {
      await teardown(fake)
    }
  })

  it('fails loud as read-only BEFORE any server round-trip and writes nothing', async () => {
    const { fake, workspace, filePath } = await fixture({
      fsOptions: { sandboxMode: 'read-only' },
      services: { sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: workspace }) } },
    })
    try {
      const { runner, calls } = fakeRunner({})
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      await expect(tool.execute({ file_path: 'a.ts' }, fakeExec(workspace))).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_READ_ONLY' }),
      )
      await expect(tool.execute({ file_path: 'a.ts' }, fakeExec(workspace))).rejects.toThrow(
        /\[sandbox: file access denied under read-only mode\]/,
      )
      expect(calls).toHaveLength(0)
      expect(await readFile(filePath, 'utf8')).toBe('const x = 1\n')
      expect(fake.writeIntents).toHaveLength(0)
    } finally {
      await teardown(fake)
    }
  })

  it('escalates from read-only through an approved one-shot retry and writes', async () => {
    const { fake, workspace, filePath } = await fixture({
      fsOptions: { sandboxMode: 'read-only' },
      services: {
        sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: workspace }) },
        approval: { request: async () => 'allowed-once' },
      },
    })
    try {
      const { runner } = fakeRunner({ formatDocument: { kind: 'edits', edits: [edit(0, 'const x = 1', 'let x = 1')] } })
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      const value = await tool.execute(
        { file_path: 'a.ts', sandbox_permissions: 'workspace-write', justification: 'the formatter must update the file' },
        fakeExec(workspace),
      ) as { kind: string }
      expect(value.kind).toBe('formatted')
      expect(await readFile(filePath, 'utf8')).toBe('let x = 1\n')
    } finally {
      await teardown(fake)
    }
  })

  it('fails the escalation when the user rejects it, writing nothing', async () => {
    const { fake, workspace, filePath } = await fixture({
      fsOptions: { sandboxMode: 'read-only' },
      services: {
        sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: workspace }) },
        approval: { request: async () => 'rejected' },
      },
    })
    try {
      const { runner, calls } = fakeRunner({})
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      await expect(tool.execute(
        { file_path: 'a.ts', sandbox_permissions: 'workspace-write', justification: 'the formatter must update the file' },
        fakeExec(workspace),
      )).rejects.toThrow(/user rejected/)
      expect(calls).toHaveLength(0)
      expect(await readFile(filePath, 'utf8')).toBe('const x = 1\n')
    } finally {
      await teardown(fake)
    }
  })

  it('maps a stale write-intent failure to a structured conflict asking the model to choose', async () => {
    const staleVersion = FsVersion('v0-0')
    const { fake, workspace } = await fixture({ writeIntent: { kind: 'replaceIfVersion', version: staleVersion } })
    try {
      const { runner } = fakeRunner({ formatDocument: { kind: 'edits', edits: [edit(0, 'const x = 1', 'let x = 1')] } })
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      await expect(tool.execute({ file_path: 'a.ts' }, fakeExec(workspace))).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_CONFLICT' }),
      )
      await expect(tool.execute({ file_path: 'a.ts' }, fakeExec(workspace))).rejects.toThrow(/changed on disk after it was read/)
    } finally {
      await teardown(fake)
    }
  })

  it('returns an unchanged result and writes nothing when the server has no edits', async () => {
    const { fake, workspace } = await fixture({})
    try {
      const { runner } = fakeRunner({ formatDocument: { kind: 'edits', edits: [] } })
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      const value = await tool.execute({ file_path: 'a.ts' }, fakeExec(workspace)) as { kind: string; file_path: string }
      expect(value).toEqual({ kind: 'unchanged', file_path: 'a.ts' })
      expect(fake.writeIntents).toHaveLength(0)
    } finally {
      await teardown(fake)
    }
  })

  it('rejects overlapping edits as a conflict without writing', async () => {
    const { fake, workspace } = await fixture({})
    try {
      const { runner } = fakeRunner({
        formatDocument: {
          kind: 'edits',
          edits: [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } }, newText: 'A' },
            { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } }, newText: 'B' },
          ],
        },
      })
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      await expect(tool.execute({ file_path: 'a.ts' }, fakeExec(workspace))).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_CONFLICT' }),
      )
      expect(fake.writeIntents).toHaveLength(0)
    } finally {
      await teardown(fake)
    }
  })

  it('maps a sandbox backend denial to the shared [sandbox: …] marker', async () => {
    const { fake, workspace } = await fixture({
      fsOptions: { sandboxMode: 'workspace-write', writeDenied: true },
      services: { sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) } },
    })
    try {
      const { runner } = fakeRunner({ formatDocument: { kind: 'edits', edits: [edit(0, 'const x = 1', 'let x = 1')] } })
      registerFormatTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_format')
      await expect(tool.execute({ file_path: 'a.ts' }, fakeExec(workspace))).rejects.toThrow(
        /\[sandbox: file access denied under workspace-write mode\]/,
      )
    } finally {
      await teardown(fake)
    }
  })
})

describe('lsp_rename tool', () => {
  /** Build a fake whose workspace holds `a.ts` and `other.ts`, with the given services/fs options. */
  async function fixture(options: {
    fsOptions?: Parameters<typeof createFakeContext>[0]['fsOptions']
    services?: Parameters<typeof createFakeContext>[0]['services']
    writeIntent?: Parameters<typeof createFakeContext>[0]['writeIntent']
  }): Promise<{ fake: FakeContext; workspace: string; aUri: string; otherUri: string }> {
    const fake = await createFakeContext({
      cwd: process.cwd(),
      fsOptions: options.fsOptions,
      services: options.services,
      writeIntent: options.writeIntent,
    })
    const workspace = join(fake.fs.root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'const oldName = 1\n')
    await writeFile(join(workspace, 'other.ts'), 'export { oldName }\n')
    const aTarget = await fake.fs.resolve('a.ts', { cwd: workspace })
    const otherTarget = await fake.fs.resolve('other.ts', { cwd: workspace })
    return { fake, workspace, aUri: fake.fs.fileUrl(aTarget), otherUri: fake.fs.fileUrl(otherTarget) }
  }

  async function teardown(fake: FakeContext): Promise<void> {
    await disposeFakeContext(fake)
  }

  const args = { file_path: 'a.ts', line: 1, character: 10, new_name: 'newName' }

  /** The `oldName` token in `a.ts` (`const oldName = 1`), characters 6..13. */
  const aToken = (newText: string): LspTextEdit => ({
    range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
    newText,
  })

  it('applies workspace edits through write-intent and reports the per-file diffs', async () => {
    const { fake, workspace, aUri, otherUri } = await fixture({
      fsOptions: { sandboxMode: 'workspace-write' },
      services: { sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) } },
    })
    try {
      const { runner, calls } = fakeRunner({
        rename: {
          kind: 'rename',
          edits: {
            [aUri]: [aToken('newName')],
            [otherUri]: [{ range: { start: { line: 0, character: 9 }, end: { line: 0, character: 16 } }, newText: 'newName' }],
          },
        },
      })
      registerRenameTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_rename')
      const value = await tool.execute(args, fakeExec(workspace)) as {
        kind: string
        new_name: string
        filesChanged: number
        appliedEdits: number
        diffs: Array<{ file_path: string; before: string; after: string }>
      }
      expect(value.kind).toBe('renamed')
      expect(value.new_name).toBe('newName')
      expect(value.filesChanged).toBe(2)
      expect(value.appliedEdits).toBe(2)
      expect(value.diffs).toHaveLength(2)
      expect(await readFile(join(workspace, 'a.ts'), 'utf8')).toBe('const newName = 1\n')
      expect(await readFile(join(workspace, 'other.ts'), 'utf8')).toBe('export { newName }\n')
      expect(calls).toHaveLength(1)
      expect(calls[0]?.position).toEqual({ line: 0, character: 9 })
      expect(fake.writeIntents).toHaveLength(2)
      // Two pre-flight observations plus one per completed write.
      expect(fake.observed).toHaveLength(4)
    } finally {
      await teardown(fake)
    }
  })

  it('fails loud as read-only BEFORE any server round-trip and writes nothing', async () => {
    const { fake, workspace } = await fixture({
      fsOptions: { sandboxMode: 'read-only' },
      services: { sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: workspace }) } },
    })
    try {
      const { runner, calls } = fakeRunner({})
      registerRenameTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_rename')
      await expect(tool.execute(args, fakeExec(workspace))).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_READ_ONLY' }),
      )
      expect(calls).toHaveLength(0)
      expect(await readFile(join(workspace, 'a.ts'), 'utf8')).toBe('const oldName = 1\n')
      expect(fake.writeIntents).toHaveLength(0)
    } finally {
      await teardown(fake)
    }
  })

  it('returns an unchanged result and writes nothing when the server has no edits', async () => {
    const { fake, workspace } = await fixture({})
    try {
      const { runner } = fakeRunner({ rename: { kind: 'rename', edits: {} } })
      registerRenameTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_rename')
      const value = await tool.execute(args, fakeExec(workspace)) as { kind: string; new_name: string }
      expect(value).toEqual({ kind: 'unchanged', file_path: 'a.ts', new_name: 'newName' })
      expect(fake.writeIntents).toHaveLength(0)
    } finally {
      await teardown(fake)
    }
  })

  it('refuses edits outside the workspace as a conflict before writing anything', async () => {
    const { fake, workspace, aUri } = await fixture({})
    try {
      const { runner } = fakeRunner({
        rename: {
          kind: 'rename',
          edits: {
            [aUri]: [aToken('newName')],
            'file:///elsewhere/x.ts': [edit(0, 'oldName', 'newName')],
          },
        },
      })
      registerRenameTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_rename')
      await expect(tool.execute(args, fakeExec(workspace))).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_CONFLICT' }),
      )
      await expect(tool.execute(args, fakeExec(workspace))).rejects.toThrow(/outside the workspace/)
      expect(fake.writeIntents).toHaveLength(0)
      expect(await readFile(join(workspace, 'a.ts'), 'utf8')).toBe('const oldName = 1\n')
    } finally {
      await teardown(fake)
    }
  })

  it('rejects overlapping edits in one file as a conflict before writing anything', async () => {
    const { fake, workspace, aUri } = await fixture({})
    try {
      const { runner } = fakeRunner({
        rename: {
          kind: 'rename',
          edits: {
            [aUri]: [
              { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } }, newText: 'A' },
              { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } }, newText: 'B' },
            ],
          },
        },
      })
      registerRenameTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_rename')
      await expect(tool.execute(args, fakeExec(workspace))).rejects.toThrow(
        expect.objectContaining({ code: 'LSP_ACTION_CONFLICT' }),
      )
      expect(fake.writeIntents).toHaveLength(0)
    } finally {
      await teardown(fake)
    }
  })

  it('drops no-op files from the write plan', async () => {
    const { fake, workspace, aUri, otherUri } = await fixture({})
    try {
      const { runner } = fakeRunner({
        rename: {
          kind: 'rename',
          edits: {
            [aUri]: [aToken('newName')],
            [otherUri]: [{ range: { start: { line: 0, character: 9 }, end: { line: 0, character: 16 } }, newText: 'oldName' }],
          },
        },
      })
      registerRenameTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_rename')
      const value = await tool.execute(args, fakeExec(workspace)) as { filesChanged: number; appliedEdits: number; diffs: unknown[] }
      expect(value.filesChanged).toBe(1)
      expect(value.appliedEdits).toBe(1)
      expect(value.diffs).toHaveLength(1)
      expect(fake.writeIntents).toHaveLength(1)
    } finally {
      await teardown(fake)
    }
  })

  it('rejects a blank or multiline new_name before any server round-trip', async () => {
    const { fake, workspace } = await fixture({})
    try {
      const { runner, calls } = fakeRunner({})
      registerRenameTool(fake.ctx as never, runner, new FormatSandboxController(fake.ctx as never), CONFIG)
      const tool = toolByName(fake, 'lsp_rename')
      await expect(tool.execute({ ...args, new_name: '  ' }, fakeExec(workspace))).rejects.toThrow(/non-empty/)
      await expect(tool.execute({ ...args, new_name: 'a\nb' }, fakeExec(workspace))).rejects.toThrow(/single-line/)
      expect(calls).toHaveLength(0)
    } finally {
      await teardown(fake)
    }
  })
})
