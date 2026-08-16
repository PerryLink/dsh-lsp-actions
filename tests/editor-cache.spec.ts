import { describe, expect, it } from 'vitest'
import { LruDiagnosticsCache } from '../src/editor/cache.ts'
import type { CachedDiagnostics } from '../src/editor/cache.ts'

function snapshot(filePath: string, message = 'e'): CachedDiagnostics {
  return {
    filePath,
    diagnostics: [{ severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message }],
    truncated: false,
    total: 1,
    updatedAt: 1,
  }
}

describe('LruDiagnosticsCache', () => {
  it('rejects a non-positive bound at construction', () => {
    expect(() => new LruDiagnosticsCache(0)).toThrow(/positive integer/)
    expect(() => new LruDiagnosticsCache(-1)).toThrow(/positive integer/)
    expect(() => new LruDiagnosticsCache(1.5)).toThrow(/positive integer/)
  })

  it('stores and reads snapshots, refreshing recency', () => {
    const cache = new LruDiagnosticsCache(2)
    cache.set(snapshot('/ws/a.ts'))
    cache.set(snapshot('/ws/b.ts'))
    expect(cache.size).toBe(2)
    expect(cache.get('/ws/a.ts')?.filePath).toBe('/ws/a.ts')
    // a.ts is now most-recent; setting c.ts must evict b.ts (least-recently-used), not a.ts.
    cache.set(snapshot('/ws/c.ts'))
    expect(cache.keys).toEqual(['/ws/a.ts', '/ws/c.ts'])
    expect(cache.get('/ws/b.ts')).toBeUndefined()
  })

  it('evicts least-recently-used beyond the bound without any access', () => {
    const cache = new LruDiagnosticsCache(2)
    cache.set(snapshot('/ws/a.ts'))
    cache.set(snapshot('/ws/b.ts'))
    cache.set(snapshot('/ws/c.ts'))
    expect(cache.keys).toEqual(['/ws/b.ts', '/ws/c.ts'])
    expect(cache.size).toBe(2)
  })

  it('replacing an entry refreshes its position and content', () => {
    const cache = new LruDiagnosticsCache(2)
    cache.set(snapshot('/ws/a.ts', 'old'))
    cache.set(snapshot('/ws/b.ts'))
    cache.set(snapshot('/ws/a.ts', 'new'))
    expect(cache.get('/ws/a.ts')?.diagnostics[0]?.message).toBe('new')
    cache.set(snapshot('/ws/c.ts'))
    // b.ts was least-recent; a.ts survived because its replacement refreshed it.
    expect(cache.keys).toEqual(['/ws/a.ts', '/ws/c.ts'])
  })

  it('deletes, clears, and re-binds the capacity', () => {
    const cache = new LruDiagnosticsCache(3)
    cache.set(snapshot('/ws/a.ts'))
    cache.set(snapshot('/ws/b.ts'))
    expect(cache.delete('/ws/a.ts')).toBe(true)
    expect(cache.delete('/ws/a.ts')).toBe(false)
    expect(cache.size).toBe(1)
    cache.setCapacity(1)
    expect(cache.size).toBe(1)
    cache.set(snapshot('/ws/c.ts'))
    expect(cache.keys).toEqual(['/ws/c.ts'])
    cache.clear()
    expect(cache.size).toBe(0)
    expect(() => cache.setCapacity(0)).toThrow(/positive integer/)
  })

  it('holds the exact configured bound under pressure', () => {
    const cache = new LruDiagnosticsCache(4)
    for (let index = 0; index < 100; index += 1) cache.set(snapshot(`/ws/f${index}.ts`))
    expect(cache.size).toBe(4)
    expect(cache.keys).toEqual(['/ws/f96.ts', '/ws/f97.ts', '/ws/f98.ts', '/ws/f99.ts'])
  })
})
