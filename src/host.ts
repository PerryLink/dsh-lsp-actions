/**
 * Filesystem-seam source access for the LSP action client: canonicalizing the workspace and
 * reading the byte-bounded transient document that `didOpen` synchronizes with the server.
 * @module dsh-lsp-actions/host
 */

import { Buffer } from 'node:buffer'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'

/** A canonical workspace in the filesystem/subprocess execution world. */
export interface HostWorkspace {
  /** Stable filesystem identity used for client pooling. */
  readonly target: FsTarget
  /** Canonical absolute path accepted as a subprocess cwd. */
  readonly canonicalPath: string
  /** Canonical file URI sent during LSP initialization. */
  readonly fileUrl: string
}

/** A validated source and the exact URI sent to the language server. */
export interface HostSource {
  /** The resolved file target, for observations and guarded writes. */
  readonly target: FsTarget
  /** Canonical file URI in the execution world's platform syntax. */
  readonly fileUrl: string
  /** Current complete UTF-8 text. */
  readonly text: string
  /** Opaque freshness token of the target at read time, for guarded writes and observations. */
  readonly version?: import('@deepseek-ai/dsh-fs').FsVersion
}

/**
 * Resolve and validate one workspace through `ctx.fs`.
 * @param fs - filesystem provider sharing the language server's execution world.
 * @param workspaceRoot - caller-supplied workspace path.
 * @param signal - optional cancellation around provider operations.
 * @returns stable identity plus process path and file URI.
 */
export async function canonicalizeWorkspace(
  fs: FileSystem,
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<HostWorkspace> {
  throwIfAborted(signal)
  let target: FsTarget
  try {
    target = await fs.resolve(workspaceRoot, signal === undefined ? {} : { signal })
  } catch (error: unknown) {
    throwIfAborted(signal)
    throw new Error(`workspace root "${workspaceRoot}" cannot be resolved: ${messageOf(error)}`, { cause: error })
  }
  throwIfAborted(signal)
  const info = await fs.stat(target, signal).catch((error: unknown) => {
    throwIfAborted(signal)
    throw error
  })
  throwIfAborted(signal)
  if (info?.type !== 'directory') {
    throw new Error(`workspace root "${workspaceRoot}" is not a directory`)
  }
  return {
    target,
    canonicalPath: fs.processPath(target),
    fileUrl: fs.fileUrl(target),
  }
}

/**
 * Resolve, contain, and read one byte-bounded source through `ctx.fs`, carrying back the
 * freshness token so a formatting write can observe and guard the exact bytes the server saw.
 * @param fs - filesystem provider sharing the server's execution world.
 * @param filePath - absolute source path or path relative to `workspace`.
 * @param workspace - already-canonical workspace.
 * @param maxDocumentBytes - largest complete source accepted by this host.
 * @param signal - optional cancellation.
 * @returns canonical file URI, current text, and freshness token.
 */
export async function readHostSource(
  fs: FileSystem,
  filePath: string,
  workspace: HostWorkspace,
  maxDocumentBytes: number,
  signal?: AbortSignal,
): Promise<HostSource> {
  throwIfAborted(signal)
  let target: FsTarget
  try {
    target = await fs.resolve(filePath, {
      cwd: workspace.canonicalPath,
      ...signal === undefined ? {} : { signal },
    })
  } catch (error: unknown) {
    throwIfAborted(signal)
    throw new Error(`source "${filePath}" cannot be resolved: ${messageOf(error)}`, { cause: error })
  }
  throwIfAborted(signal)
  if (!fs.contains(workspace.target, target)) {
    throw new Error(`source "${filePath}" resolves outside the workspace`)
  }
  const info = await fs.stat(target, signal).catch((error: unknown) => {
    throwIfAborted(signal)
    throw error
  })
  throwIfAborted(signal)
  const chunks: string[] = []
  let bytes = 0
  try {
    const stream = await fs.streamText(target, signal)
    for await (const chunk of stream) {
      throwIfAborted(signal)
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxDocumentBytes) break
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    throwIfAborted(signal)
    throw new Error(`source "${filePath}" could not be read: ${messageOf(error)}`, { cause: error })
  }
  if (bytes > maxDocumentBytes) {
    throw new Error(
      `source "${filePath}" exceeds the ${maxDocumentBytes}-byte limit; reading stopped after ${bytes} bytes`,
    )
  }
  throwIfAborted(signal)
  return {
    target,
    fileUrl: fs.fileUrl(target),
    text: chunks.join(''),
    ...info === undefined ? {} : { version: info.version },
  }
}

/** Throw the signal's abort reason when the signal has fired. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason
}

/** Normalize a `file:` URI for identity comparison: decoded path, case-folded on Windows. */
export function normalizeFileUri(uri: string): string {
  return foldFileUri(decodeFileUri(uri))
}

/** Decode a `file:` URI's percent escapes without case-folding, so path slicing stays exact. */
export function decodeFileUri(uri: string): string {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') return uri
    return `file://${decodeURIComponent(url.pathname)}`
  } catch {
    return uri
  }
}

function foldFileUri(uri: string): string {
  if (process.platform !== 'win32') return uri
  const marker = 'file://'
  if (!uri.startsWith(marker)) return uri
  return `${marker}${uri.slice(marker.length).toLowerCase()}`
}

/**
 * The workspace-relative path one document URI points at, when the URI lies under the canonical
 * workspace URI. Servers re-spell the root URI sent at `initialize` (lowercase drive letters and
 * percent-encoded colons on Windows, a trailing slash on either side), so containment is judged on
 * decoded, case-insensitive forms while the relative path itself is sliced from the decoded URI —
 * a normalized string can differ in length from the raw one, which would shift the cut.
 * @param workspace - the canonical workspace.
 * @param uri - the document URI the server named.
 * @returns the relative path (`.` for the workspace root itself), or undefined when the URI does
 *   not fall under the workspace.
 */
export function workspaceRelativePath(workspace: HostWorkspace, uri: string): string | undefined {
  const root = decodeFileUri(workspace.fileUrl)
  const decoded = decodeFileUri(uri)
  const identity = (candidate: string): string => process.platform === 'win32' ? candidate.toLowerCase() : candidate
  if (identity(decoded) === identity(root)) return '.'
  const prefix = root.endsWith('/') ? root : `${root}/`
  if (!identity(decoded).startsWith(identity(prefix))) return undefined
  return decoded.slice(prefix.length)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
