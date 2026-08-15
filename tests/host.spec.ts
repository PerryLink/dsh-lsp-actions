import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { canonicalizeWorkspace, normalizeFileUri, readHostSource, throwIfAborted, workspaceRelativePath } from '../src/host.ts'
import { FakeFs } from './helpers/fake-ctx.ts'

let root: string
let fs: FakeFs

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-actions-host-')))
  fs = new FakeFs(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('canonicalizeWorkspace', () => {
  it('resolves a directory workspace into target, process path, and file url', async () => {
    const workspace = await canonicalizeWorkspace(fs, root)
    expect(workspace.canonicalPath).toBe(root)
    expect(workspace.fileUrl).toMatch(/^file:/)
  })

  it('fails loudly when the workspace cannot be resolved', async () => {
    await expect(canonicalizeWorkspace(fs, join(root, 'missing'))).rejects.toThrow(/cannot be resolved/)
  })

  it('fails loudly when the workspace is not a directory', async () => {
    const file = join(root, 'plain.txt')
    await writeFile(file, 'x')
    await expect(canonicalizeWorkspace(fs, file)).rejects.toThrow(/not a directory/)
  })
})

describe('readHostSource', () => {
  it('reads a contained file with its freshness token', async () => {
    await writeFile(join(root, 'a.ts'), 'hello\n')
    const workspace = await canonicalizeWorkspace(fs, root)
    const source = await readHostSource(fs, 'a.ts', workspace, 1000)
    expect(source.text).toBe('hello\n')
    expect(source.version).toBeDefined()
    expect(source.fileUrl).toMatch(/a\.ts$/)
  })

  it('rejects a source outside the workspace', async () => {
    await writeFile(join(root, '..', 'outside.ts').replaceAll('\\', '/'), 'x')
    const workspace = await canonicalizeWorkspace(fs, root)
    await expect(readHostSource(fs, join('..', 'outside.ts'), workspace, 1000)).rejects.toThrow(/outside the workspace/)
  })

  it('rejects a source that exceeds the byte cap', async () => {
    await writeFile(join(root, 'big.ts'), 'x'.repeat(64))
    const workspace = await canonicalizeWorkspace(fs, root)
    await expect(readHostSource(fs, 'big.ts', workspace, 16)).rejects.toThrow(/exceeds the 16-byte limit/)
  })

  it('rejects an unresolvable source', async () => {
    const workspace = await canonicalizeWorkspace(fs, root)
    await expect(readHostSource(fs, 'missing.ts', workspace, 1000)).rejects.toThrow(/could not be read|cannot be resolved/)
  })

  it('rejects an already-aborted signal before any work', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    const workspace = await canonicalizeWorkspace(fs, root)
    await expect(readHostSource(fs, 'a.ts', workspace, 1000, controller.signal)).rejects.toThrow('stopped')
  })
})

describe('throwIfAborted', () => {
  it('throws the signal reason when aborted and stays silent otherwise', () => {
    const live = new AbortController()
    expect(() => throwIfAborted(live.signal)).not.toThrow()
    const dead = new AbortController()
    dead.abort(new Error('gone'))
    expect(() => throwIfAborted(dead.signal)).toThrow('gone')
    expect(() => throwIfAborted(undefined)).not.toThrow()
  })
})

describe('workspaceRelativePath', () => {
  it('maps a uri under the workspace root to its relative path', async () => {
    const workspace = await canonicalizeWorkspace(fs, root)
    expect(workspaceRelativePath(workspace, workspace.fileUrl)).toBe('.')
    expect(workspaceRelativePath(workspace, `${workspace.fileUrl}/src/a%20b.ts`)).toBe('src/a b.ts')
  })

  it('maps a server re-spelled Windows uri (lowercase drive, encoded colon) without shifting the cut', async () => {
    if (process.platform !== 'win32') return
    const workspace = await canonicalizeWorkspace(fs, root)
    const respelled = workspace.fileUrl.replace(
      /^file:\/\/\/([A-Za-z]):/,
      (_match, drive: string) => `file:///${drive.toLowerCase()}%3A`,
    )
    expect(respelled).not.toBe(workspace.fileUrl)
    expect(workspaceRelativePath(workspace, `${respelled}/src/a.ts`)).toBe('src/a.ts')
    expect(workspaceRelativePath(workspace, respelled)).toBe('.')
  })

  it('returns undefined for a uri outside the workspace', async () => {
    const workspace = await canonicalizeWorkspace(fs, root)
    expect(workspaceRelativePath(workspace, 'file:///elsewhere/a.ts')).toBeUndefined()
  })
})

describe('normalizeFileUri', () => {
  it('decodes percent escapes and passes non-file uris through', () => {
    expect(normalizeFileUri('file:///ws/a%20b.ts')).toBe('file:///ws/a b.ts')
    expect(normalizeFileUri('untitled:x')).toBe('untitled:x')
  })
})
