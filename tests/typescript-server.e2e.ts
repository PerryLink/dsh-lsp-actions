/**
 * Real-server verification: typescript-language-server over the plugin's assembled stack (apply →
 * tools → runner → own client → stdio spawn). Skipped when the server binary is unavailable; run
 * with LSP_ACTIONS_TSLS to point at another checkout's copy. This is the "真实语言服务器实测"
 * deliverable gate: diagnostics, formatting (applied through write-intent), and completion.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../src/index.ts'
import { createFakeContext, disposeFakeContext, fakeExec } from './helpers/fake-ctx.ts'
import type { FakeContext } from './helpers/fake-ctx.ts'
import type { LspServerEntry } from '../src/index.ts'

/** The typescript-language-server CLI entry, overridable for other machines. */
const TSLS = process.env.LSP_ACTIONS_TSLS
  ?? fileURLToPath(new URL('../../../../packages/lsp/lsp-stdio/node_modules/typescript-language-server/lib/cli.mjs', import.meta.url))

const CONFIG = {
  servers: {} as Record<string, LspServerEntry>,
  maxDiagnostics: 200,
  maxCompletionItems: 20,
  maxResultChars: 16_000,
  maxDocumentBytes: 4_000_000,
  timeoutMs: 120_000,
}

let fake: FakeContext
let workspace: string

beforeAll(async () => {
  fake = await createFakeContext({ cwd: process.cwd() })
  workspace = join(fake.fs.root, 'project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n')
  await writeFile(join(workspace, 'a.ts'), 'function f() {\n  const x = 1;\n    return x;\n}\nconst n: number = "text"\n')
})

afterAll(async () => {
  await disposeFakeContext(fake)
  await rm(join(fake.fs.root, 'project'), { recursive: true, force: true })
})

const tslsAvailable = existsSync(TSLS)

describe.skipIf(!tslsAvailable)('typescript-language-server end-to-end', () => {
  beforeAll(async () => {
    CONFIG.servers = {
      tsls: {
        command: process.execPath,
        args: [TSLS, '--stdio'],
        extensionToLanguage: { '.ts': 'typescript' },
        fileGlobs: [],
        env: {},
        initializationOptions: null,
        configuration: null,
        formattingOptions: { tabSize: 2, insertSpaces: true },
        maxMessageBytes: 16_000_000,
        maxStderrBytes: 1_000_000,
        killGraceMs: 2_000,
        shutdownTimeoutMs: 5_000,
        // tsls publishes the first diagnostics ~2.4s after didOpen (project load + configuration
        // round trip); the settle window must cover a cold start.
        diagnosticsSettleMs: 5_000,
      },
    }
    await apply(fake.ctx as never, CONFIG)
  })

  afterAll(async () => {
    await Promise.all(fake.disposers.map(disposer => disposer()))
  })

  it('reports real type diagnostics with severity and source', async () => {
    const tool = fake.tools.find(candidate => candidate.name === 'lsp_diagnostics')
    if (tool === undefined) throw new Error('lsp_diagnostics was not registered')
    const value = await tool.execute({ file_path: 'a.ts' }, fakeExec(workspace)) as {
      diagnostics: Array<{ severity: number; message: string; source?: string }>
    }
    const errors = value.diagnostics.filter(diagnostic => diagnostic.severity === 1)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(diagnostic => diagnostic.source === 'typescript')).toBe(true)
    expect(errors.some(diagnostic => /not assignable|not comparable/i.test(diagnostic.message))).toBe(true)
  }, 120_000)

  it('formats the file through the server and writes the result', async () => {
    const tool = fake.tools.find(candidate => candidate.name === 'lsp_format')
    if (tool === undefined) throw new Error('lsp_format was not registered')
    const value = await tool.execute({ file_path: 'a.ts' }, fakeExec(workspace)) as {
      kind: string
      appliedEdits: number
    }
    expect(value.kind).toBe('formatted')
    expect(value.appliedEdits).toBeGreaterThan(0)
    const formatted = await readFile(join(workspace, 'a.ts'), 'utf8')
    expect(formatted).toContain('  return x;')
    expect(formatted).not.toContain('    return x;')
  }, 120_000)

  it('returns completion suggestions at a cursor position', async () => {
    const tool = fake.tools.find(candidate => candidate.name === 'lsp_completion')
    if (tool === undefined) throw new Error('lsp_completion was not registered')
    const value = await tool.execute({ file_path: 'a.ts', line: 1, character: 7 }, fakeExec(workspace)) as {
      items: Array<{ label: string }>
    }
    expect(value.items.length).toBeGreaterThan(0)
    expect(value.items.every(item => typeof item.label === 'string')).toBe(true)
  }, 120_000)
})
