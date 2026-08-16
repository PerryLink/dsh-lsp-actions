/**
 * Real-server editor-protocol verification: the editor actions against the real
 * typescript-language-server (the plugin repo's devDependency copy) over the assembled stack —
 * service + seam-first runner + own client + stdio spawn. The quickfix leg of the full chain stays
 * on the deterministic fixture LSP server (tests/editor-protocol.spec.ts), because tsls's code
 * action catalog for a given error is version-dependent; here we verify the editor protocol's
 * diagnostics and format legs against the real server.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LspActionClient } from '../src/client.ts'
import { LruDiagnosticsCache } from '../src/editor/cache.ts'
import { EditorActionService } from '../src/editor/service.ts'
import { createActionRunner } from '../src/runner.ts'
import { FormatSandboxController } from '../src/sandbox.ts'
import { resolveServers } from '../src/servers.ts'
import type { ResolvedConfig, ResolvedServerEntry } from '../src/servers.ts'
import { createFakeContext, disposeFakeContext } from './helpers/fake-ctx.ts'
import type { FakeContext } from './helpers/fake-ctx.ts'

const TSLS = process.env.LSP_ACTIONS_TSLS
  ?? fileURLToPath(new URL('../node_modules/typescript-language-server/lib/cli.mjs', import.meta.url))

const CONFIG: ResolvedConfig = {
  servers: {},
  editor: { enabled: false, requestTimeoutMs: 120_000, diagnosticsCacheMaxFiles: 8 },
  maxDiagnostics: 200,
  maxCompletionItems: 20,
  maxCodeActions: 50,
  maxSymbols: 100,
  maxSignatures: 10,
  maxInlayHints: 200,
  maxResultChars: 16_000,
  maxDocumentBytes: 4_000_000,
  timeoutMs: 120_000,
}

function tslsEntry(): ResolvedServerEntry {
  return {
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
    diagnosticsSettleMs: 5_000,
    diagnosticsDebounceMs: 250,
    idleTimeoutMs: 0,
  }
}

let fake: FakeContext
let workspace: string
let client: LspActionClient
let stop: () => void
let service: EditorActionService

beforeAll(async () => {
  fake = await createFakeContext({ cwd: process.cwd() })
  workspace = join(fake.fs.root, 'project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n')
  await writeFile(join(workspace, 'a.ts'), 'function f() {\n    const y = 1;\n}\nconst n: number = \'text\'\n')
  const servers = await resolveServers(fake.ctx as never, { tsls: tslsEntry() } as never)
  const sandbox = new FormatSandboxController(fake.ctx as never)
  client = new LspActionClient(fake.ctx.subprocess as never, fake.ctx.fs as never, CONFIG.maxDocumentBytes)
  const runner = createActionRunner({ getSeam: () => fake.ctx.get('lsp') as never, client, servers })
  const cache = new LruDiagnosticsCache(CONFIG.editor.diagnosticsCacheMaxFiles)
  service = new EditorActionService(fake.ctx as never, runner, sandbox, CONFIG, cache)
  stop = service.start()
})

afterAll(async () => {
  stop()
  await client.disposeAll()
  await disposeFakeContext(fake)
  await rm(workspace, { recursive: true, force: true })
})

const tslsAvailable = existsSync(TSLS)

describe.skipIf(!tslsAvailable)('editor protocol against the real typescript-language-server', () => {
  it('diagnostics.get reports real type errors through the editor envelope', async () => {
    const result = await service.run({ action: 'diagnostics.get', requestId: 'd1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
    expect(result.status).toBe('succeeded')
    const payload = result.result as { kind: string; diagnostics: Array<{ severity: number; source?: string; message: string }> }
    expect(payload.kind).toBe('diagnostics')
    const errors = payload.diagnostics.filter(diagnostic => diagnostic.severity === 1)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(diagnostic => diagnostic.source === 'typescript')).toBe(true)
    expect(errors.some(diagnostic => /not assignable/i.test(diagnostic.message))).toBe(true)
  }, 120_000)

  it('format applies the real server formatting through the editor envelope', async () => {
    const result = await service.run({ action: 'format', requestId: 'f1', params: { filePath: 'a.ts', workspaceRoot: workspace } })
    expect(result.status).toBe('succeeded')
    expect(result.result).toMatchObject({ kind: 'formatted', filePath: 'a.ts' })
    const formatted = await readFile(join(workspace, 'a.ts'), 'utf8')
    expect(formatted).toContain('  const y = 1;')
    expect(formatted).not.toContain('    const y = 1;')
  }, 120_000)

  it('quickfix.apply with an unknown title fails with the stable code against the real server', async () => {
    const result = await service.run({ action: 'quickfix.apply', requestId: 'q1', params: { filePath: 'a.ts', workspaceRoot: workspace, title: 'no-such-fix' } })
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('LSP_ACTION_UNKNOWN')
  }, 120_000)
})
