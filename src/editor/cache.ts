/**
 * The bounded diagnostics cache for the editor protocol: a Map-backed LRU keyed by absolute file
 * path, capped by `maxFiles`. Entries carry the freshness token of the source they were computed
 * against, so a `quickfix.apply` without an explicit range can refuse stale first-diagnostic
 * targeting instead of applying a fix to a line that moved. Every access refreshes recency; the
 * bound evicts least-recently-used entries, so memory is bounded by config, not by history.
 * @module dsh-lsp-actions/editor/cache
 */

import type { EditorDiagnostic } from './types.ts'

/** One cached diagnostics snapshot for a file. */
export interface CachedDiagnostics {
  /** The absolute file path the snapshot covers. */
  readonly filePath: string
  /** The source freshness token the diagnostics were computed against (absent when unknown). */
  readonly version?: string
  /** The snapshot's diagnostics, already count-capped by the action. */
  readonly diagnostics: readonly EditorDiagnostic[]
  /** Whether the snapshot is truncated at the configured cap. */
  readonly truncated: boolean
  /** The server-reported total before capping. */
  readonly total: number
  /** Wall-clock time of the snapshot (ms epoch), for diagnostics and tests. */
  readonly updatedAt: number
}

/**
 * A bounded LRU cache of diagnostics snapshots. `maxFiles` is validated at construction and may be
 * reduced later; entries are evicted least-recently-used first until the bound holds.
 */
export class LruDiagnosticsCache {
  private readonly entries = new Map<string, CachedDiagnostics>()

  constructor(private maxFiles: number) {
    if (!Number.isInteger(maxFiles) || maxFiles <= 0) {
      throw new TypeError('editor.diagnosticsCacheMaxFiles must be a positive integer')
    }
  }

  /** The current bound. */
  get capacity(): number {
    return this.maxFiles
  }

  /** The number of cached files. */
  get size(): number {
    return this.entries.size
  }

  /** The absolute file paths currently cached, most-recently-accessed last. */
  get keys(): readonly string[] {
    return [...this.entries.keys()]
  }

  /** Read one snapshot, refreshing its recency. */
  get(filePath: string): CachedDiagnostics | undefined {
    const entry = this.entries.get(filePath)
    if (entry === undefined) return undefined
    // Refresh recency: re-insertion moves the entry to the tail of the map.
    this.entries.delete(filePath)
    this.entries.set(filePath, entry)
    return entry
  }

  /** Store one snapshot, evicting least-recently-used entries beyond the bound. */
  set(entry: CachedDiagnostics): void {
    this.entries.delete(entry.filePath)
    this.entries.set(entry.filePath, entry)
    this.evict()
  }

  /** Drop one file's snapshot (no-op when absent). */
  delete(filePath: string): boolean {
    return this.entries.delete(filePath)
  }

  /** Drop every snapshot. */
  clear(): void {
    this.entries.clear()
  }

  /** Change the bound, evicting immediately when it shrinks. */
  setCapacity(maxFiles: number): void {
    if (!Number.isInteger(maxFiles) || maxFiles <= 0) {
      throw new TypeError('editor.diagnosticsCacheMaxFiles must be a positive integer')
    }
    this.maxFiles = maxFiles
    this.evict()
  }

  private evict(): void {
    while (this.entries.size > this.maxFiles) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}
