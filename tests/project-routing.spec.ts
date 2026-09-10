/**
 * Project-marker routing (issue #4): one extension, several sibling projects, one language server
 * each. The suite covers the four issue bullets — the project config decides, `deno.json` /
 * `deno.jsonc` are honored, a Deno sibling never leaks into a Node project, and moving a project
 * needs no configuration change — at three levels: the pure router, the filesystem walk, and the
 * assembled plugin against the real fixture server.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { LspActionClient } from '../src/client.ts'
import type { HostSource } from '../src/host.ts'
import { apply } from '../src/index.ts'
import type { LspServerEntry } from '../src/index.ts'
import { configuredProjectMarkers, findProjectMarker } from '../src/project.ts'
import { createActionRunner } from '../src/runner.ts'
import { routeFile } from '../src/servers.ts'
import type { ResolvedServer, ResolvedServerEntry } from '../src/servers.ts'
import { createFakeContext, disposeFakeContext, fakeExec, FakeFs, rmDirWithDrain } from './helpers/fake-ctx.ts'
import type { FakeContext } from './helpers/fake-ctx.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/lsp-fixture-server.mjs', import.meta.url))

/** The issue's Deno marker set: the JSONC spelling counts as a project config too. */
const DENO_MARKERS = ['deno.json', 'deno.jsonc']
/** The issue's Node/TypeScript marker set. */
const TYPESCRIPT_MARKERS = ['package.json', 'tsconfig.json']

/** One resolved server entry for the routing tests (every schemastery default restated). */
function resolvedServer(
  serverId: string,
  extensionToLanguage: Record<string, string>,
  projectMarkers: string[] = [],
  fileGlobs: string[] = [],
): ResolvedServer {
  const entry: ResolvedServerEntry = {
    command: 'node',
    extensionToLanguage,
    fileGlobs,
    projectMarkers,
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
  }
  return { serverId, entry, executable: 'node' }
}

/** The two servers the issue asks for: both serve `.ts`, only their project markers differ. */
const nodeServer = resolvedServer('typescript', { '.ts': 'typescript', '.tsx': 'typescriptreact' }, TYPESCRIPT_MARKERS)
const denoServer = resolvedServer('deno', { '.ts': 'typescript', '.tsx': 'typescriptreact' }, DENO_MARKERS)

describe('routeFile with a project marker', () => {
  const servers = [nodeServer, denoServer]

  it('routes a Deno project file to the Deno entry and a Node project file to the TypeScript entry', () => {
    expect(routeFile(servers, 'apps/node-app/src/main.ts', 'package.json')?.server.serverId).toBe('typescript')
    expect(routeFile(servers, 'apps/deno-app/src/main.ts', 'deno.json')?.server.serverId).toBe('deno')
    expect(routeFile(servers, 'apps/deno-app/src/main.tsx', 'deno.jsonc')?.server.serverId).toBe('deno')
  })

  it('keeps the configured language id of the marked entry', () => {
    expect(routeFile(servers, 'apps/deno-app/src/main.tsx', 'deno.json')?.languageId).toBe('typescriptreact')
  })

  it('ignores a marker no entry claims and falls back to the extension map', () => {
    expect(routeFile(servers, 'apps/node-app/src/main.ts', 'composer.json')?.server.serverId).toBe('typescript')
  })

  it('lets a marker decide only among the entries that map the extension', () => {
    const vue = resolvedServer('vue', { '.vue': 'vue' }, ['deno.json'])
    const route = routeFile([nodeServer, vue], 'apps/deno-app/src/main.ts', 'deno.json')
    // The Deno marker is claimed by an entry that cannot serve TypeScript: the extension map wins.
    expect(route?.server.serverId).toBe('typescript')
    expect(routeFile([nodeServer, vue], 'apps/deno-app/src/App.vue', 'deno.json')?.server.serverId).toBe('vue')
  })

  it('picks the earliest configured entry when several claim the same marker', () => {
    const first = resolvedServer('first', { '.ts': 'typescript' }, ['package.json'])
    const second = resolvedServer('second', { '.ts': 'typescript' }, ['package.json'])
    expect(routeFile([first, second], 'a.ts', 'package.json')?.server.serverId).toBe('first')
  })

  it('keeps an explicit fileGlob ahead of the project marker', () => {
    const globbed = resolvedServer('globbed', { '.ts': 'typescript' }, [], ['apps/**/*.ts'])
    expect(routeFile([nodeServer, globbed], 'apps/node-app/src/main.ts', 'package.json')?.server.serverId).toBe('globbed')
  })

  it('leaves routing untouched when no marker is supplied', () => {
    expect(routeFile(servers, 'apps/deno-app/src/main.ts')?.server.serverId).toBe('typescript')
    expect(routeFile([denoServer, nodeServer], 'apps/node-app/src/main.ts')?.server.serverId).toBe('deno')
  })
})

describe('configuredProjectMarkers', () => {
  it('collects every declared marker once, in config order', () => {
    const both = resolvedServer('both', { '.ts': 'typescript' }, ['package.json', 'deno.json', 'package.json'])
    expect(configuredProjectMarkers([nodeServer, both, denoServer])).toEqual([
      'package.json',
      'tsconfig.json',
      'deno.json',
      'deno.jsonc',
    ])
  })

  it('is empty when no entry declares one', () => {
    expect(configuredProjectMarkers([resolvedServer('plain', { '.ts': 'typescript' })])).toEqual([])
  })
})

describe('findProjectMarker', () => {
  let root: string
  let fs: FakeFs
  let workspace: string
  const markers = [...TYPESCRIPT_MARKERS, ...DENO_MARKERS]

  /** Create one file under the temp root (the workspace is `<root>/ws`), with its parents. */
  async function writeFileUnderRoot(relativePath: string, text: string): Promise<void> {
    const absolute = join(root, relativePath)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, text)
  }

  /** Create one source file under the temp root, with its parent directories. */
  async function writeSource(relativePath: string, text = 'const x = 1\n'): Promise<void> {
    await writeFileUnderRoot(relativePath, text)
  }

  /** Create one project marker file under the temp root, with its parent directories. */
  async function writeMarker(relativePath: string): Promise<void> {
    await writeFileUnderRoot(relativePath, '{}\n')
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-actions-project-')))
    workspace = join(root, 'ws')
    await mkdir(workspace)
    fs = new FakeFs(root)
    // The issue's workspace: a Node project and a Deno project sharing the .ts extension.
    await writeMarker('ws/package.json')
    await writeMarker('ws/apps/node-app/package.json')
    await writeMarker('ws/apps/node-app/tsconfig.json')
    await writeMarker('ws/apps/deno-app/deno.json')
    await writeMarker('ws/apps/deno-jsonc-app/deno.jsonc')
    await writeSource('ws/apps/node-app/src/main.ts')
    await writeSource('ws/apps/deno-app/src/main.ts')
    await writeSource('ws/apps/deno-app/src/deep/nested/extra.ts')
    await writeSource('ws/apps/deno-jsonc-app/src/main.ts')
    await writeSource('ws/apps/plain-app/src/main.ts')
    await writeSource('ws/top-level.ts')
    await writeMarker('outside/deno.json')
    await writeSource('outside/main.ts')
  })

  afterEach(async () => {
    await rmDirWithDrain(root)
  })

  it('takes the nearest ancestor marker: the sibling projects do not share one', async () => {
    expect(await findProjectMarker(fs, markers, 'apps/node-app/src/main.ts', workspace)).toBe('package.json')
    expect(await findProjectMarker(fs, markers, 'apps/deno-app/src/main.ts', workspace)).toBe('deno.json')
  })

  it('accepts deno.jsonc as a Deno project config', async () => {
    expect(await findProjectMarker(fs, markers, 'apps/deno-jsonc-app/src/main.ts', workspace)).toBe('deno.jsonc')
  })

  it('climbs past directories without a marker and stops at the workspace root', async () => {
    expect(await findProjectMarker(fs, markers, 'apps/deno-app/src/deep/nested/extra.ts', workspace)).toBe('deno.json')
    expect(await findProjectMarker(fs, markers, 'apps/plain-app/src/main.ts', workspace)).toBe('package.json')
    expect(await findProjectMarker(fs, markers, 'top-level.ts', workspace)).toBe('package.json')
  })

  it('never applies a sibling project marker to a Node project', async () => {
    // The Deno marker exists one directory over; the Node file's own project config wins.
    expect(await findProjectMarker(fs, markers, 'apps/node-app/src/main.ts', workspace)).toBe('package.json')
    // Removing the Node project's own markers falls back to the workspace root, not to the sibling.
    await rm(join(workspace, 'apps/node-app/package.json'))
    await rm(join(workspace, 'apps/node-app/tsconfig.json'))
    expect(await findProjectMarker(fs, markers, 'apps/node-app/src/main.ts', workspace)).toBe('package.json')
    // With no configured marker anywhere above it, nothing claims the file.
    expect(await findProjectMarker(fs, ['deno.json'], 'apps/node-app/src/main.ts', workspace)).toBeUndefined()
  })

  it('follows a project that is moved, with no path rule anywhere', async () => {
    await rename(join(workspace, 'apps/deno-app'), join(workspace, 'apps/deno-app-moved'))
    expect(await findProjectMarker(fs, markers, 'apps/deno-app-moved/src/main.ts', workspace)).toBe('deno.json')
    // The untouched Node project keeps its own server in the same workspace.
    expect(await findProjectMarker(fs, markers, 'apps/node-app/src/main.ts', workspace)).toBe('package.json')
  })

  it('ignores a marker no entry declares', async () => {
    expect(await findProjectMarker(fs, TYPESCRIPT_MARKERS, 'apps/deno-app/src/main.ts', workspace)).toBe('package.json')
  })

  it('probes the workspace root itself when the path is the root', async () => {
    expect(await findProjectMarker(fs, markers, workspace, workspace)).toBe('package.json')
  })

  it('returns undefined for a file outside the workspace', async () => {
    expect(await findProjectMarker(fs, markers, join(root, 'outside/main.ts'), workspace)).toBeUndefined()
  })

  it('makes no filesystem call without markers or without a file path', async () => {
    const poisoned = {
      resolve: () => { throw new Error('resolve must not be called') },
      fileUrl: () => { throw new Error('fileUrl must not be called') },
      lstat: () => { throw new Error('lstat must not be called') },
    } as unknown as FileSystem
    expect(await findProjectMarker(poisoned, [], 'apps/deno-app/src/main.ts', workspace)).toBeUndefined()
    expect(await findProjectMarker(poisoned, markers, '   ', workspace)).toBeUndefined()
  })

  it('treats an unresolvable file as having no project context', async () => {
    expect(await findProjectMarker(fs, markers, 'apps/deno-app/src/not-created-yet.ts', workspace)).toBeUndefined()
  })

  it('treats a failing marker probe as absent and keeps climbing', async () => {
    const flaky = {
      resolve: (path: string, opts?: { cwd?: string }) => fs.resolve(path, opts),
      processPath: (target: Parameters<FakeFs['processPath']>[0]) => fs.processPath(target),
      fileUrl: (target: Parameters<FakeFs['fileUrl']>[0]) => fs.fileUrl(target),
      lstat: async () => { throw new Error('EACCES') },
    } as unknown as FileSystem
    expect(await findProjectMarker(flaky, ['deno.json'], 'apps/deno-app/src/main.ts', workspace)).toBeUndefined()
  })

  it('surfaces cancellation instead of a probe failure', async () => {
    const controller = new AbortController()
    const aborting = {
      resolve: (path: string, opts?: { cwd?: string }) => fs.resolve(path, opts),
      processPath: (target: Parameters<FakeFs['processPath']>[0]) => fs.processPath(target),
      fileUrl: (target: Parameters<FakeFs['fileUrl']>[0]) => fs.fileUrl(target),
      lstat: async () => {
        controller.abort(new Error('cancelled by the caller'))
        throw new Error('aborted probe')
      },
    } as unknown as FileSystem
    await expect(findProjectMarker(aborting, markers, 'apps/deno-app/src/main.ts', workspace, controller.signal))
      .rejects.toThrow('cancelled by the caller')
  })

  it('rejects up front when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already cancelled'))
    await expect(findProjectMarker(fs, markers, 'apps/deno-app/src/main.ts', workspace, controller.signal))
      .rejects.toThrow('already cancelled')
  })
})

describe('createActionRunner project routing', () => {
  let root: string
  let workspace: string
  let fs: FakeFs
  const source: HostSource = {
    target: { targetKey: FsTargetKey('ws/a.ts'), displayPath: 'a.ts' },
    fileUrl: 'file:///ws/a.ts',
    text: 'const x = 1\n',
    version: FsVersion('v1'),
  }

  /** A client double recording which server entry each call was routed to. */
  function clientDouble(): { client: LspActionClient; routed: string[] } {
    const routed: string[] = []
    const client = {
      diagnostics: async (server: ResolvedServer) => {
        routed.push(server.serverId)
        return { kind: 'diagnostics' as const, diagnostics: [] }
      },
      workspaceSymbols: async (server: ResolvedServer) => {
        routed.push(server.serverId)
        return { kind: 'symbols' as const, items: [] }
      },
    } as unknown as LspActionClient
    return { client, routed }
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-actions-runner-')))
    workspace = join(root, 'ws')
    await mkdir(join(workspace, 'apps/node-app/src'), { recursive: true })
    await mkdir(join(workspace, 'apps/deno-app/src'), { recursive: true })
    await writeFile(join(workspace, 'apps/node-app/package.json'), '{}\n')
    await writeFile(join(workspace, 'apps/node-app/src/main.ts'), 'const x = 1\n')
    await writeFile(join(workspace, 'apps/deno-app/deno.json'), '{}\n')
    await writeFile(join(workspace, 'apps/deno-app/src/main.ts'), 'const x = 1\n')
    fs = new FakeFs(root)
  })

  afterEach(async () => {
    await rmDirWithDrain(root)
  })

  it('routes each file to the server its own project config selects', async () => {
    const { client, routed } = clientDouble()
    const runner = createActionRunner({ getSeam: () => undefined, client, servers: [nodeServer, denoServer], fs })
    await runner.diagnostics({ filePath: 'apps/node-app/src/main.ts', workspaceRoot: workspace, source })
    await runner.diagnostics({ filePath: 'apps/deno-app/src/main.ts', workspaceRoot: workspace, source })
    await runner.diagnostics({ filePath: 'apps/node-app/src/main.ts', workspaceRoot: workspace, source })
    expect(routed).toEqual(['typescript', 'deno', 'typescript'])
  })

  it('keeps the extension-map order when no filesystem is supplied', async () => {
    const { client, routed } = clientDouble()
    const runner = createActionRunner({ getSeam: () => undefined, client, servers: [nodeServer, denoServer] })
    await runner.diagnostics({ filePath: 'apps/deno-app/src/main.ts', workspaceRoot: workspace, source })
    expect(routed).toEqual(['typescript'])
  })

  it('never touches the filesystem when no entry declares a project marker', async () => {
    const { client, routed } = clientDouble()
    const poisoned = {
      resolve: () => { throw new Error('resolve must not be called') },
      processPath: () => { throw new Error('processPath must not be called') },
      fileUrl: () => { throw new Error('fileUrl must not be called') },
      lstat: () => { throw new Error('lstat must not be called') },
    } as unknown as FileSystem
    const runner = createActionRunner({
      getSeam: () => undefined,
      client,
      servers: [resolvedServer('plain', { '.ts': 'typescript' })],
      fs: poisoned,
    })
    await runner.diagnostics({ filePath: 'apps/deno-app/src/main.ts', workspaceRoot: workspace, source })
    expect(routed).toEqual(['plain'])
  })

  it('serves a document-free workspace symbol search from the first server', async () => {
    const { client, routed } = clientDouble()
    const runner = createActionRunner({ getSeam: () => undefined, client, servers: [nodeServer, denoServer], fs })
    await runner.workspaceSymbols({ filePath: '', workspaceRoot: workspace, query: 'findMe' })
    expect(routed).toEqual(['typescript'])
  })
})

describe('project-marker routing end to end', () => {
  let root: string
  let fake: FakeContext
  let workspace: string

  /** A fully-defaulted entry, matching what the schemastery loader hands apply(). */
  function serverEntry(command: string, extensionToLanguage: Record<string, string>, overrides: Partial<LspServerEntry>): LspServerEntry {
    return {
      command,
      extensionToLanguage,
      fileGlobs: [],
      projectMarkers: [],
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

  /** One fixture-backed entry per project kind; `--ask-config` embeds the entry's identity in the result. */
  const config = {
    servers: {
      typescript: serverEntry(process.execPath, { '.ts': 'typescript' }, {
        args: [FIXTURE, '--ask-config'],
        configuration: { typescript: 'ts-server' },
        projectMarkers: TYPESCRIPT_MARKERS,
      }),
      deno: serverEntry(process.execPath, { '.ts': 'typescript' }, {
        args: [FIXTURE, '--ask-config'],
        configuration: { typescript: 'deno-lsp' },
        projectMarkers: DENO_MARKERS,
      }),
    },
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

  /** Run lsp_diagnostics on a workspace-relative file and return which server answered. */
  async function servedBy(relativePath: string): Promise<string> {
    const tool = fake.tools.find(candidate => candidate.name === 'lsp_diagnostics')
    if (tool === undefined) throw new Error('lsp_diagnostics was not registered')
    const value = await tool.execute({ file_path: relativePath }, fakeExec(workspace)) as {
      diagnostics: Array<{ message: string }>
    }
    const message = value.diagnostics[0]?.message ?? ''
    const match = /\[config:"([^"]+)"\]/u.exec(message)
    if (match?.[1] === undefined) throw new Error(`the fixture server did not report its identity: ${message}`)
    return match[1]
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-actions-e2e-')))
    fake = await createFakeContext({ cwd: root })
    workspace = join(fake.fs.root, 'ws')
    // The issue's fixture: apps/node-app/{package.json,tsconfig.json,src/main.ts} next to
    // apps/deno-app/{deno.json,src/main.ts}, both holding a .ts file, plus a deno.jsonc sibling.
    await mkdir(join(workspace, 'apps/node-app/src'), { recursive: true })
    await mkdir(join(workspace, 'apps/deno-app/src'), { recursive: true })
    await mkdir(join(workspace, 'apps/deno-jsonc-app/src'), { recursive: true })
    await writeFile(join(workspace, 'package.json'), '{}\n')
    await writeFile(join(workspace, 'apps/node-app/package.json'), '{}\n')
    await writeFile(join(workspace, 'apps/node-app/tsconfig.json'), '{}\n')
    await writeFile(join(workspace, 'apps/node-app/src/main.ts'), 'alpha\n    beta\ngamma\n')
    await writeFile(join(workspace, 'apps/deno-app/deno.json'), '{}\n')
    await writeFile(join(workspace, 'apps/deno-app/src/main.ts'), 'alpha\n    beta\ngamma\n')
    await writeFile(join(workspace, 'apps/deno-jsonc-app/deno.jsonc'), '{}\n')
    await writeFile(join(workspace, 'apps/deno-jsonc-app/src/main.ts'), 'alpha\n    beta\ngamma\n')
  })

  afterEach(async () => {
    await Promise.all(fake.disposers.map(disposer => disposer()))
    await disposeFakeContext(fake)
    await rm(root, { recursive: true, force: true })
  })

  it('serves sibling projects that share the .ts extension with their own language server', async () => {
    await apply(fake.ctx as never, config)

    // Bullet 2: the same extension, two projects, two servers — decided by each project's config.
    expect(await servedBy('apps/node-app/src/main.ts')).toBe('ts-server')
    expect(await servedBy('apps/deno-app/src/main.ts')).toBe('deno-lsp')
    expect(await servedBy('apps/deno-jsonc-app/src/main.ts')).toBe('deno-lsp')

    // Bullet 3: dropping the Deno project's config changes nothing for the Node sibling, and the
    // Deno file falls back to the plain extension default instead of borrowing a sibling marker.
    await rm(join(workspace, 'apps/deno-app/deno.json'))
    expect(await servedBy('apps/node-app/src/main.ts')).toBe('ts-server')
    expect(await servedBy('apps/deno-app/src/main.ts')).toBe('ts-server')

    // Bullet 4: the project moves — config and all — with no rule to update anywhere.
    await rename(join(workspace, 'apps/deno-app'), join(workspace, 'apps/deno-app-moved'))
    await writeFile(join(workspace, 'apps/deno-app-moved/deno.json'), '{}\n')
    expect(await servedBy('apps/deno-app-moved/src/main.ts')).toBe('deno-lsp')
    expect(await servedBy('apps/node-app/src/main.ts')).toBe('ts-server')
  })
})
