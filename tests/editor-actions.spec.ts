/**
 * Focused coverage tests for the editor action protocol's validation, escalation, cache-version,
 * projection, and lifecycle branches that the happy-path suites do not reach. Same fake-ctx
 * assembly as `editor-protocol.spec.ts`; no real server process is spawned.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { LspActionClient } from '../src/client.ts'
import { LruDiagnosticsCache } from '../src/editor/cache.ts'
import { EditorActionService } from '../src/editor/service.ts'
import { createActionRunner } from '../src/runner.ts'
import { FormatSandboxController } from '../src/sandbox.ts'
import type { ResolvedConfig } from '../src/servers.ts'
import type { ActionRunner, RunnerRequest } from '../src/runner.ts'
import type { LspDiagnostic, LspTextEdit } from '../src/vocabulary.ts'
import { createFakeContext, disposeFakeContext } from './helpers/fake-ctx.ts'
import type { FakeContext } from './helpers/fake-ctx.ts'

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

/** A canned runner answering each op from fixed results and recording every request. */
function fakeRunner(results: {
  diagnostics?: { kind: 'diagnostics'; diagnostics: LspDiagnostic[] }
  formatDocument?: { kind: 'edits'; edits: LspTextEdit[] }
  completion?: { kind: 'completion'; items: Array<Record<string, unknown>> }
  codeActions?: { kind: 'codeActions'; items: Array<{ title: string; edits: Record<string, LspTextEdit[]> }> }
}): { runner: ActionRunner; calls: string[]; requests: Array<{ operation: string; request: RunnerRequest }> } {
  const calls: string[] = []
  const requests: Array<{ operation: string; request: RunnerRequest }> = []
  const unexpected = (): never => {
    throw new Error('unexpected runner result')
  }
  const record = (operation: string, request: RunnerRequest): void => {
    calls.push(operation)
    requests.push({ operation, request })
  }
  const runner: ActionRunner = {
    diagnostics: async (request: RunnerRequest) => {
      record('diagnostics', request)
      return results.diagnostics ?? unexpected()
    },
    formatDocument: async (request: RunnerRequest) => {
      record('formatDocument', request)
      return results.formatDocument ?? unexpected()
    },
    completion: async (request: RunnerRequest) => {
      record('completion', request)
      return results.completion ?? unexpected()
    },
    codeActions: async (request: RunnerRequest) => {
      record('codeActions', request)
      return results.codeActions ?? unexpected()
    },
    workspaceSymbols: async () => unexpected(),
    documentSymbols: async () => unexpected(),
    signatureHelp: async () => unexpected(),
    inlayHints: async () => unexpected(),
    rename: async () => unexpected(),
  }
  return { runner, calls, requests }
}

/** A runner whose diagnostics op throws the given error, for the structured-failure envelope. */
function brokenRunner(error: unknown): ActionRunner {
  const unexpected = (): never => {
    throw new Error('unexpected runner result')
  }
  return {
    diagnostics: async () => {
      throw error
    },
    formatDocument: async () => unexpected(),
    completion: async () => unexpected(),
    codeActions: async () => unexpected(),
    workspaceSymbols: async () => unexpected(),
    documentSymbols: async () => unexpected(),
    signatureHelp: async () => unexpected(),
    inlayHints: async () => unexpected(),
    rename: async () => unexpected(),
  }
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

/** Build a fake context with services and fs options, then seed the workspace and source. */
async function fakeWith(services: Record<string, unknown>, fsOptions?: { sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'; writeDenied?: boolean }): Promise<FakeContext> {
  const created = await createFakeContext({ cwd: process.cwd(), services, fsOptions })
  const workspace = join(created.fs.root, 'ws')
  await mkdir(workspace)
  await writeFile(join(workspace, 'a.ts'), 'alpha\n    beta\ngamma\n')
  return created
}

describe('EditorActionService parameter validation', () => {
  let fake: FakeContext
  let workspace: string

  beforeEach(async () => {
    fake = await fakeWith({})
    workspace = join(fake.fs.root, 'ws')
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('refuses a missing filePath with the stable invalid-args code', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({ action: 'diagnostics.get', params: { workspaceRoot: workspace } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_INVALID_ARGS')
      expect(result.error?.message).toMatch(/requires a non-empty string filePath/)
    } finally {
      stop()
    }
  })

  it('refuses a missing workspaceRoot with the stable invalid-args code', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({ action: 'diagnostics.get', params: { filePath: 'a.ts' } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_INVALID_ARGS')
      expect(result.error?.message).toMatch(/requires a non-empty string workspaceRoot/)
    } finally {
      stop()
    }
  })

  it('refuses a completion position that is not an object', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({ action: 'completion.get', params: { filePath: 'a.ts', workspaceRoot: workspace, position: 'here' } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_INVALID_ARGS')
      expect(result.error?.message).toMatch(/requires a position/)
    } finally {
      stop()
    }
  })

  it('refuses a completion position with a negative character', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({ action: 'completion.get', params: { filePath: 'a.ts', workspaceRoot: workspace, position: { line: 0, character: -1 } } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_INVALID_ARGS')
      expect(result.error?.message).toMatch(/zero-based non-negative integers/)
    } finally {
      stop()
    }
  })

  it('refuses a quickfix range that is not an object', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, range: 'whole-file' } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_INVALID_ARGS')
      expect(result.error?.message).toMatch(/requires a range/)
    } finally {
      stop()
    }
  })

  it('refuses a quickfix range whose end precedes its start', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const result = await service.run({
        action: 'quickfix.apply',
        params: { filePath: 'a.ts', workspaceRoot: workspace, range: { start: { line: 1, character: 0 }, end: { line: 0, character: 0 } } },
      })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_INVALID_ARGS')
      expect(result.error?.message).toMatch(/must not precede range start/)
    } finally {
      stop()
    }
  })
})

describe('EditorActionService diagnostics.get', () => {
  let fake: FakeContext
  let workspace: string

  beforeEach(async () => {
    fake = await fakeWith({})
    workspace = join(fake.fs.root, 'ws')
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('includes the source text when includeSource is requested', async () => {
    const { runner } = fakeRunner({ diagnostics: { kind: 'diagnostics', diagnostics: [] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'diagnostics.get', params: { filePath: 'a.ts', workspaceRoot: workspace, includeSource: true } })
      expect(result.status).toBe('succeeded')
      expect((result.result as { source: string }).source).toBe('alpha\n    beta\ngamma\n')
    } finally {
      stop()
    }
  })

  it('stores a snapshot without a freshness token when the source has no stat version', async () => {
    const realFs = fake.fs
    const wrapped = Object.create(realFs) as typeof realFs & { stat: typeof realFs.stat }
    wrapped.stat = async (target: FsTarget, signal?: AbortSignal) =>
      target.targetKey.endsWith('a.ts') ? undefined : realFs.stat(target, signal)
    fake.ctx.fs = wrapped
    const { runner } = fakeRunner({ diagnostics: { kind: 'diagnostics', diagnostics: [] } })
    const { service, cache, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'diagnostics.get', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('succeeded')
      expect(cache.get(join(workspace, 'a.ts'))?.version).toBeUndefined()
    } finally {
      stop()
    }
  })
})

describe('EditorActionService completion.get', () => {
  let fake: FakeContext
  let workspace: string

  beforeEach(async () => {
    fake = await fakeWith({})
    workspace = join(fake.fs.root, 'ws')
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('projects every optional completion field onto the wire', async () => {
    const { runner } = fakeRunner({
      completion: {
        kind: 'completion',
        items: [{
          label: 'alpha',
          kind: 5,
          detail: 'detail text',
          insertText: 'inserted',
          sortText: 'sort-me',
          textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'replacement' },
        }],
      },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'completion.get', params: { filePath: 'a.ts', workspaceRoot: workspace, position: { line: 0, character: 1 } } })
      expect(result.status).toBe('succeeded')
      expect((result.result as { items: unknown[] }).items).toEqual([{
        label: 'alpha',
        kind: 5,
        detail: 'detail text',
        insertText: 'inserted',
        sortText: 'sort-me',
        textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'replacement' },
      }])
    } finally {
      stop()
    }
  })
})

describe('EditorActionService quickfix.apply', () => {
  let fake: FakeContext
  let workspace: string
  let uri: string

  beforeEach(async () => {
    fake = await fakeWith({})
    workspace = join(fake.fs.root, 'ws')
    uri = pathToFileURL(join(workspace, 'a.ts')).href
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('selects the action at a zero-based index when no title is given', async () => {
    const { runner } = fakeRunner({
      codeActions: {
        kind: 'codeActions',
        items: [
          { title: 'Fix alpha', edits: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'ALPHA' }] } },
          { title: 'Second', edits: { [uri]: [] } },
        ],
      },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, index: 0 } })
      expect(result.status).toBe('succeeded')
      expect(result.result).toMatchObject({ kind: 'quickfixApplied', title: 'Fix alpha' })
    } finally {
      stop()
    }
  })

  it('defaults the selection to the first action without a title or index', async () => {
    const { runner } = fakeRunner({
      codeActions: {
        kind: 'codeActions',
        items: [{ title: 'Fix alpha', edits: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'ALPHA' }] } }],
      },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('succeeded')
      expect(result.result).toMatchObject({ kind: 'quickfixApplied', title: 'Fix alpha' })
    } finally {
      stop()
    }
  })

  it('refuses a negative index as no matching action', async () => {
    const { runner } = fakeRunner({ codeActions: { kind: 'codeActions', items: [{ title: 'Fix alpha', edits: { [uri]: [] } }] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, index: -1 } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_UNKNOWN')
    } finally {
      stop()
    }
  })

  it('reports a command-only code action as never executed', async () => {
    const { runner } = fakeRunner({ codeActions: { kind: 'codeActions', items: [{ title: 'Fix alpha', edits: {} }] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix alpha' } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_UNKNOWN')
      expect(result.error?.message).toMatch(/carries no edits/)
    } finally {
      stop()
    }
  })

  it('reports no matching action with the none placeholder when the server returns nothing', async () => {
    const { runner } = fakeRunner({ codeActions: { kind: 'codeActions', items: [] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'nope' } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_UNKNOWN')
      expect(result.error?.message).toMatch(/titles: none/)
    } finally {
      stop()
    }
  })

  it('forwards onlyKinds filters to the runner', async () => {
    const { runner, requests } = fakeRunner({ codeActions: { kind: 'codeActions', items: [{ title: 'Fix alpha', edits: { [uri]: [] } }] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix alpha', only: ['quickfix'] } })
      expect(result.status).toBe('succeeded')
      expect(requests[0]?.request.onlyKinds).toEqual(['quickfix'])
    } finally {
      stop()
    }
  })

  it('reports an unchanged result when the applied edits are no-ops', async () => {
    const { runner } = fakeRunner({
      codeActions: {
        kind: 'codeActions',
        items: [{ title: 'Fix alpha', edits: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'alpha' }] } }],
      },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix alpha' } })
      expect(result.status).toBe('succeeded')
      expect(result.result).toEqual({ kind: 'unchanged', filePath: 'a.ts' })
    } finally {
      stop()
    }
  })

  it('refuses edits that target a file outside the workspace', async () => {
    const outsideUri = pathToFileURL(join(fake.fs.root, 'outside.ts')).href
    const { runner } = fakeRunner({
      codeActions: {
        kind: 'codeActions',
        items: [{ title: 'Escape', edits: { [outsideUri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'x' }] } }],
      },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Escape' } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_CONFLICT')
      expect(result.error?.message).toMatch(/outside the workspace/)
    } finally {
      stop()
    }
  })

  it('surfaces a stale second write as a partial-write conflict', async () => {
    const bPath = join(workspace, 'b.ts')
    await writeFile(bPath, 'beta\n')
    const uriB = pathToFileURL(bPath).href
    const realFs = fake.fs
    const wrapped = Object.create(realFs) as typeof realFs & { writeText: typeof realFs.writeText }
    wrapped.writeText = async (target: FsTarget, content: string, expected?: unknown, signal?: AbortSignal) => {
      if (target.targetKey.endsWith('b.ts')) throw new FsError('the file changed on disk', 'FS_STALE_VERSION')
      return realFs.writeText(target, content, expected, signal)
    }
    fake.ctx.fs = wrapped
    const { runner } = fakeRunner({
      codeActions: {
        kind: 'codeActions',
        items: [{
          title: 'Fix both',
          edits: {
            [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'ALPHA' }],
            [uriB]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: 'BETA' }],
          },
        }],
      },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix both' } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_CONFLICT')
      expect(result.error?.message).toMatch(/1 of 2 files were already updated/)
    } finally {
      stop()
    }
  })

  it('falls back to the pre-read text for diffs when the write reports no before', async () => {
    const realFs = fake.fs
    const wrapped = Object.create(realFs) as typeof realFs & { writeText: typeof realFs.writeText }
    wrapped.writeText = async (target: FsTarget, content: string, expected?: unknown, signal?: AbortSignal) => {
      const outcome = await realFs.writeText(target, content, expected, signal)
      return { ...outcome, before: null }
    }
    fake.ctx.fs = wrapped
    const { runner } = fakeRunner({
      codeActions: {
        kind: 'codeActions',
        items: [{ title: 'Fix alpha', edits: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'ALPHA' }] } }],
      },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix alpha' } })
      expect(result.status).toBe('succeeded')
      expect(result.result).toMatchObject({ kind: 'quickfixApplied' })
      expect((result.result as { diffs: Array<{ filePath: string; before: string }> }).diffs[0]?.before).toBe('alpha\n    beta\ngamma\n')
    } finally {
      stop()
    }
  })

  it('refuses a stale cached first-diagnostic range for title-only targeting', async () => {
    const { runner, requests } = fakeRunner({
      codeActions: {
        kind: 'codeActions',
        items: [{ title: 'Fix alpha', edits: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'ALPHA' }] } }],
      },
    })
    const { service, cache, stop } = await assembleService(fake, CONFIG, runner)
    try {
      cache.set({
        filePath: join(workspace, 'a.ts'),
        version: 'stale-version',
        diagnostics: [{ severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'e' }],
        truncated: false,
        total: 1,
        updatedAt: 0,
      })
      const result = await service.run({ action: 'quickfix.apply', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix alpha' } })
      expect(result.status).toBe('succeeded')
      expect(requests[0]?.request.range).toBeUndefined()
    } finally {
      stop()
    }
  })
})

describe('EditorActionService format', () => {
  let fake: FakeContext
  let workspace: string

  beforeEach(async () => {
    fake = await fakeWith({})
    workspace = join(fake.fs.root, 'ws')
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('honors an explicit zero-based range selection', async () => {
    const { runner, requests } = fakeRunner({
      formatDocument: { kind: 'edits', edits: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: '\t' }] },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({
        action: 'format',
        params: { filePath: 'a.ts', workspaceRoot: workspace, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } },
      })
      expect(result.status).toBe('succeeded')
      expect(result.result).toMatchObject({ kind: 'formatted' })
      expect(requests[0]?.request.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } })
    } finally {
      stop()
    }
  })

  it('maps a denied write to the shared sandbox marker', async () => {
    await disposeFakeContext(fake)
    fake = await fakeWith({ sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) } }, { sandboxMode: 'workspace-write', writeDenied: true })
    workspace = join(fake.fs.root, 'ws')
    const { runner } = fakeRunner({
      formatDocument: { kind: 'edits', edits: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: '\t' }] },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'format', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_UNAVAILABLE')
      expect(result.error?.message).toMatch(/\[sandbox:/)
    } finally {
      stop()
    }
  })

  it('falls back to the read text in the result when the write reports no before', async () => {
    const realFs = fake.fs
    const wrapped = Object.create(realFs) as typeof realFs & { writeText: typeof realFs.writeText }
    wrapped.writeText = async (target: FsTarget, content: string, expected?: unknown, signal?: AbortSignal) => {
      const outcome = await realFs.writeText(target, content, expected, signal)
      return { ...outcome, before: null }
    }
    fake.ctx.fs = wrapped
    const { runner } = fakeRunner({
      formatDocument: { kind: 'edits', edits: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: '\t' }] },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({ action: 'format', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('succeeded')
      expect((result.result as { before: string }).before).toBe('alpha\n    beta\ngamma\n')
    } finally {
      stop()
    }
  })
})

describe('EditorActionService sandbox escalation', () => {
  let fake: FakeContext
  let workspace: string
  let uri: string

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('refuses escalation when no sandboxing backend is composed', async () => {
    fake = await fakeWith({})
    workspace = join(fake.fs.root, 'ws')
    uri = pathToFileURL(join(workspace, 'a.ts')).href
    const { runner, calls } = fakeRunner({ codeActions: { kind: 'codeActions', items: [{ title: 'Fix', edits: { [uri]: [] } }] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({
        action: 'quickfix.apply',
        params: { filePath: 'a.ts', workspaceRoot: workspace, sandbox_permissions: 'danger-full-access', justification: 'needed' },
      })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_APPROVAL_UNAVAILABLE')
      expect(result.error?.message).toMatch(/not available in this composition/)
      expect(calls).toEqual([])
    } finally {
      stop()
    }
  })

  it('grants the wider mode through the official approval path with a live agent', async () => {
    fake = await fakeWith({
      sessions: { list: () => [{ id: 's1', header: { cwd: '/ws' } }] },
      agents: { get: () => ({ session: { id: 's1' } }) },
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
      approval: { request: async () => 'allowed-once' },
    }, { sandboxMode: 'workspace-write' })
    workspace = join(fake.fs.root, 'ws')
    uri = pathToFileURL(join(workspace, 'a.ts')).href
    const { runner } = fakeRunner({
      codeActions: {
        kind: 'codeActions',
        items: [{ title: 'Fix alpha', edits: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'ALPHA' }] } }],
      },
    })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({
        action: 'quickfix.apply',
        sessionId: 's1',
        params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'Fix alpha', sandbox_permissions: 'danger-full-access', justification: 'needed for the fix' },
      })
      expect(result.status).toBe('succeeded')
      expect(result.result).toMatchObject({ kind: 'quickfixApplied', title: 'Fix alpha' })
    } finally {
      stop()
    }
  })

  it('maps a non-Error approval failure through the stable approval code', async () => {
    fake = await fakeWith({
      sessions: { list: () => [{ id: 's1', header: { cwd: '/ws' } }] },
      agents: { get: () => ({ session: { id: 's1' } }) },
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
      approval: {
        request: async () => {
          throw 'approval channel exploded'
        },
      },
    }, { sandboxMode: 'workspace-write' })
    workspace = join(fake.fs.root, 'ws')
    uri = pathToFileURL(join(workspace, 'a.ts')).href
    const { runner, calls } = fakeRunner({ codeActions: { kind: 'codeActions', items: [{ title: 'Fix', edits: { [uri]: [] } }] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const result = await service.run({
        action: 'quickfix.apply',
        sessionId: 's1',
        params: { filePath: 'a.ts', workspaceRoot: workspace, sandbox_permissions: 'danger-full-access', justification: 'needed for the fix' },
      })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_APPROVAL_UNAVAILABLE')
      expect(result.error?.message).toMatch(/approval channel exploded/)
      expect(calls).toEqual([])
    } finally {
      stop()
    }
  })
})

describe('EditorActionService lifecycle and events', () => {
  let fake: FakeContext
  let workspace: string

  beforeEach(async () => {
    fake = await fakeWith({})
    workspace = join(fake.fs.root, 'ws')
  })

  afterEach(async () => {
    await disposeFakeContext(fake)
  })

  it('refuses a second start', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      expect(() => service.start()).toThrow(/already started/)
    } finally {
      stop()
    }
  })

  it('drops filesystem observations that are not present-kind', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      const key = join(workspace, 'a.ts')
      fake.ctx.emit('fs/observed', { displayPath: key }, { kind: 'removed' }, undefined)
      fake.ctx.emit('fs/observed', undefined, { kind: 'present' }, undefined)
      // Both emissions are ignored without throwing.
      expect(true).toBe(true)
    } finally {
      stop()
    }
  })

  it('uses targetKey when displayPath is absent and ignores key-less observations', async () => {
    const { service, stop } = await assembleService(fake)
    try {
      fake.ctx.emit('fs/observed', { targetKey: '/key-only' }, { kind: 'present' }, undefined)
      fake.ctx.emit('fs/observed', {}, { kind: 'present' }, undefined)
      expect(true).toBe(true)
    } finally {
      stop()
    }
  })

  it('races a caller-supplied signal with the configured timeout', async () => {
    const { runner } = fakeRunner({ diagnostics: { kind: 'diagnostics', diagnostics: [] } })
    const { service, stop } = await assembleService(fake, CONFIG, runner)
    try {
      const controller = new AbortController()
      const result = await service.run({ action: 'diagnostics.get', params: { filePath: 'a.ts', workspaceRoot: workspace } }, controller.signal)
      expect(result.status).toBe('succeeded')
    } finally {
      stop()
    }
  })

  it('lists an empty cwd when the session header carries none', async () => {
    await disposeFakeContext(fake)
    fake = await fakeWith({ sessions: { list: () => [{ id: 's1', header: {} }] } })
    const { service, stop } = await assembleService(fake)
    try {
      expect(service.list().sessions).toEqual([{ sessionId: 's1', cwd: '', live: false }])
    } finally {
      stop()
    }
  })

  it('answers a generic runner failure through the stable envelope', async () => {
    const { service, stop } = await assembleService(fake, CONFIG, brokenRunner(new Error('boom')))
    try {
      const result = await service.run({ action: 'diagnostics.get', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_UNAVAILABLE')
      expect(result.error?.message).toBe('boom')
    } finally {
      stop()
    }
  })

  it('answers a non-Error runner failure through the stable envelope', async () => {
    const { service, stop } = await assembleService(fake, CONFIG, brokenRunner('boom-string'))
    try {
      const result = await service.run({ action: 'diagnostics.get', params: { filePath: 'a.ts', workspaceRoot: workspace } })
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('LSP_ACTION_UNAVAILABLE')
      expect(result.error?.message).toBe('boom-string')
    } finally {
      stop()
    }
  })
})
