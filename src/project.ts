/**
 * Project-config detection for routing: which configured marker file (if any) governs a source
 * file. The walk starts at the file's own directory and climbs to the workspace root, so one
 * extension can be served by different language servers in sibling projects — a `deno.json`
 * project next to a `package.json` project — with no hard-coded path rule and no cross-project
 * bleed: only the nearest ancestor that holds a *configured* marker claims the file, and the
 * workspace root is the hard upper bound.
 * @module dsh-lsp-actions/project
 */

import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { relativeUnderRootUri, throwIfAborted } from './host.ts'
import type { ResolvedServer } from './servers.ts'

/**
 * Every project marker some server entry declares, deduplicated in config order.
 * @param servers - the resolved servers.
 * @returns the marker file names to probe, in the order entries declare them.
 */
export function configuredProjectMarkers(servers: readonly ResolvedServer[]): string[] {
  const markers: string[] = []
  for (const server of servers) {
    for (const marker of server.entry.projectMarkers) {
      if (!markers.includes(marker)) markers.push(marker)
    }
  }
  return markers
}

/**
 * Find the marker file that governs one source file: the nearest ancestor directory — the file's
 * own directory first, the workspace root last — holding one of `markers`, scanning the markers in
 * the given order inside each directory. Directories without a configured marker are skipped, a
 * file outside the workspace has no project context, and no filesystem call is made when the
 * servers table declares no marker at all.
 * @param fs - the filesystem seam sharing the language server's execution world.
 * @param markers - the configured marker file names (see `configuredProjectMarkers`).
 * @param filePath - the source file (relative to `workspaceRoot` or absolute).
 * @param workspaceRoot - the workspace root, the walk's upper bound.
 * @param signal - optional cancellation.
 * @returns the governing marker file name, or undefined when none applies.
 */
export async function findProjectMarker(
  fs: FileSystem,
  markers: readonly string[],
  filePath: string,
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (markers.length === 0 || filePath.trim() === '') return undefined
  throwIfAborted(signal)
  let workspace: FsTarget
  let file: FsTarget
  try {
    workspace = await fs.resolve(workspaceRoot, signal === undefined ? {} : { signal })
    file = await fs.resolve(filePath, {
      cwd: fs.processPath(workspace),
      ...signal === undefined ? {} : { signal },
    })
  } catch {
    // An unresolvable path has no project context; the plain glob/extension route still applies.
    throwIfAborted(signal)
    return undefined
  }
  // Relativizing through the file URLs keeps the walk in the backend's path space and bounds it:
  // `undefined` means the file lies outside the workspace, where no configured project may claim
  // it, and `.` means the path *is* the workspace root, which has no directory of its own.
  const relative = relativeUnderRootUri(fs.fileUrl(workspace), fs.fileUrl(file))
  if (relative === undefined) return undefined
  const segments = relative === '.' ? [] : relative.split('/')
  const directories: string[] = []
  for (let length = segments.length - 1; length >= 0; length -= 1) {
    directories.push(segments.slice(0, length).join('/'))
  }
  if (directories.length === 0) directories.push('')
  for (const directory of directories) {
    for (const marker of markers) {
      if (await markerPresent(fs, directory === '' ? marker : `${directory}/${marker}`, workspaceRoot, signal)) {
        return marker
      }
    }
  }
  return undefined
}

/**
 * Whether one marker file name exists inside a workspace-relative directory. An unreadable or
 * refused probe is treated as absent: routing is a hint, and a directory that cannot be inspected
 * must not fail the action — the extension default still serves the call.
 * @param fs - the filesystem seam.
 * @param path - the workspace-relative marker path.
 * @param cwd - the workspace root the relative path resolves against.
 * @param signal - optional cancellation.
 * @returns true when a marker file (not a directory) is present.
 */
async function markerPresent(fs: FileSystem, path: string, cwd: string, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal)
  try {
    const info = await fs.lstat(path, { cwd }, signal)
    return info !== undefined && info.type !== 'directory'
  } catch {
    throwIfAborted(signal)
    return false
  }
}
