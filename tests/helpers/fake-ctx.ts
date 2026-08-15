/**
 * Test fakes for the plugin surface: a Cordis-context-shaped object (tools registry, event
 * dispatch, optional services) and a real, temp-directory-backed filesystem whose `writeText`
 * honors intent guards, sandbox denials, and observations — enough for the tools' execute paths
 * to run against real bytes without mounting the full harness.
 */

import { mkdtemp, readFile, realpath, rm, stat as nodeStat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsObservation, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import { spawnForTest, resolveExecutableForTest } from './spawn-adapter.ts'

/** The optional services a fake context can expose through `ctx.get`. */
export interface FakeServices {
  lsp?: unknown
  sandboxPolicy?: unknown
  approval?: unknown
}

/** Configuration for the fake filesystem. */
export interface FakeFsOptions {
  /** When set, `writeText` throws FS_SANDBOX_DENIED (a read-only sandboxing backend). */
  readonly writeDenied?: boolean
  /** The sandbox mode the backend reports; undefined means the backend never confines. */
  readonly sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
}

/** One recorded `fs/observed` emission. */
export interface ObservedRecord {
  readonly target: FsTarget
  readonly observation: FsObservation
  readonly actor: object | undefined
}

/** The assembled fake: context plus captured contributions. */
export interface FakeContext {
  readonly ctx: Record<string, unknown>
  /** Tools captured by `ctx.tools.register`, in registration order. */
  readonly tools: ToolDefinition[]
  /** Every `fs/observed` emission, in order. */
  readonly observed: ObservedRecord[]
  /** Every `fs/write-intent` waterfall dispatch (target + actor), in order. */
  readonly writeIntents: Array<{ target: FsTarget; actor: object | undefined }>
  /** The fake filesystem. */
  readonly fs: FakeFs
  /** Disposers returned by `ctx.effect` callbacks, for explicit teardown in tests. */
  readonly disposers: Array<() => Promise<unknown>>
}

/**
 * Create the fake context.
 * @param opts - the workspace root, optional services, fs options, and the write intent the
 *   `fs/write-intent` waterfall resolves (undefined = the bare unconditional default).
 * @returns the assembled fake.
 */
export async function createFakeContext(opts: {
  readonly cwd: string
  readonly services?: FakeServices
  readonly fsOptions?: FakeFsOptions
  readonly writeIntent?: FsWriteIntent | undefined
}): Promise<FakeContext> {
  const fs = new FakeFs(await realpath(await mkdtemp(join(tmpdir(), 'lsp-actions-'))), opts.fsOptions)
  const tools: ToolDefinition[] = []
  const observed: ObservedRecord[] = []
  const writeIntents: Array<{ target: FsTarget; actor: object | undefined }> = []
  const disposers: Array<() => Promise<unknown>> = []
  const ctx: Record<string, unknown> = {
    tools: {
      register(tool: ToolDefinition): () => void {
        tools.push(tool)
        return () => {}
      },
    },
    fs,
    subprocess: {
      spawn: (spec: unknown) => spawnForTest(spec as Parameters<typeof spawnForTest>[0]),
      resolveExecutable: (command: string) => Promise.resolve(resolveExecutableForTest(command)),
    },
    waterfall: async (name: string, ...args: unknown[]): Promise<unknown> => {
      if (name === 'fs/write-intent') {
        writeIntents.push({ target: args[0] as FsTarget, actor: args[1] as object | undefined })
        return opts.writeIntent
      }
      const next = args.at(-1) as (() => unknown) | undefined
      return typeof next === 'function' ? await next() : undefined
    },
    emit: (name: string, ...args: unknown[]): void => {
      if (name === 'fs/observed') {
        observed.push({ target: args[0] as FsTarget, observation: args[1] as FsObservation, actor: args[2] as object | undefined })
      }
    },
    get: (name: string): unknown => opts.services?.[name as keyof FakeServices],
    on: (): (() => void) => () => {},
    effect: (run: () => unknown): unknown => {
      const disposer = run()
      if (typeof disposer === 'function') disposers.push(disposer as () => Promise<unknown>)
      return Promise.resolve()
    },
  }
  return { ctx, tools, observed, writeIntents, fs, disposers }
}

/** A fake tool-execution context bound to one session cwd. */
export function fakeExec(cwd: string, signal: AbortSignal = new AbortController().signal): ToolExecution {
  return {
    agent: { session: { header: { cwd } } },
    callId: 'call-1',
    signal,
    token: 'token-1',
    name: 'lsp_format',
    arguments: {},
  } as unknown as ToolExecution
}

/** A real, temp-directory-backed filesystem honoring the seam's write contract. */
export class FakeFs {
  constructor(
    readonly root: string,
    private readonly options: FakeFsOptions = {},
  ) {}

  get sandboxMode(): 'read-only' | 'workspace-write' | 'danger-full-access' | undefined {
    return this.options.sandboxMode
  }

  async resolve(path: string, opts?: { cwd?: string }): Promise<FsTarget> {
    const absolute = resolvePath(opts?.cwd ?? this.root, path)
    const key = await realpath(absolute)
    return { targetKey: FsTargetKey(key), displayPath: absolute }
  }

  processPath(target: FsTarget): string {
    return target.targetKey
  }

  fileUrl(target: FsTarget): string {
    return pathToFileURL(target.targetKey).href
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    const prefix = parent.targetKey.endsWith(sep) ? parent.targetKey : `${parent.targetKey}${sep}`
    return child.targetKey === parent.targetKey || child.targetKey.startsWith(prefix)
  }

  async stat(target: FsTarget, _signal?: AbortSignal): Promise<{ version: ReturnType<typeof FsVersion>; type: 'file' | 'directory'; size?: number } | undefined> {
    try {
      const info = await nodeStat(target.targetKey)
      return {
        version: FsVersion(`v${info.mtimeMs}-${info.size}`),
        type: info.isDirectory() ? 'directory' : 'file',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  async readText(target: FsTarget, _signal?: AbortSignal): Promise<string> {
    return await readFile(target.targetKey, 'utf8')
  }

  async streamText(target: FsTarget, _signal?: AbortSignal): Promise<AsyncIterable<string>> {
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<string> {
        yield await readFile(target.targetKey, 'utf8')
      },
    }
  }

  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    _signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    if (this.options.writeDenied === true) {
      throw new FsError('write denied by the read-only filesystem', 'FS_SANDBOX_DENIED')
    }
    const exists = existsSync(target.targetKey)
    const before = exists ? await readFile(target.targetKey, 'utf8') : null
    if (expected?.kind === 'createIfAbsent' && exists) {
      throw new FsError('the target already exists', 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion') {
      const info = exists ? await nodeStat(target.targetKey) : undefined
      const current = info === undefined ? undefined : FsVersion(`v${info.mtimeMs}-${info.size}`)
      if (current !== expected.version) {
        throw new FsError('the target changed since it was read', 'FS_STALE_VERSION')
      }
    }
    await writeFile(target.targetKey, content)
    const info = await nodeStat(target.targetKey)
    return {
      operation: exists ? 'update' : 'create',
      version: FsVersion(`v${info.mtimeMs}-${info.size}`),
      before,
      after: content,
    }
  }
}

/** Remove a fake context's temp directory. */
export async function disposeFakeContext(fake: FakeContext): Promise<void> {
  await rmDirWithDrain(fake.fs.root)
}

/**
 * Remove a directory with a short EBUSY/EPERM retry: on Windows a terminated server tree
 * (taskkill /T) releases its cwd and file handles asynchronously, so the first recursive rm right
 * after teardown can hit EBUSY. Retrying briefly makes suite cleanup deterministic instead of
 * flaky in CI.
 */
export async function rmDirWithDrain(target: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined
      if (code !== 'EBUSY' && code !== 'EPERM') throw error
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
  throw lastError
}
