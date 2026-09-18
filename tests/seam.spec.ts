import { describe, expect, it } from 'vitest'
import { classifySeamAttempt, probeSeamVintage, trySeamAction } from '../src/seam.ts'
import type { SeamService } from '../src/seam.ts'

/** An error carrying a stable seam-style code, without depending on the seam's error class. */
const codedError = (message: string, code: string): Error => Object.assign(new Error(message), { code })

const request = { operation: 'diagnostics', filePath: 'a.ts', workspaceRoot: '/ws' } as const

describe('trySeamAction classification', () => {
  it('returns absent when no seam is mounted', async () => {
    expect(await trySeamAction(undefined, 'diagnostics', 'a.ts', '/ws', undefined, undefined)).toEqual({ ok: false, reason: 'absent' })
  })

  it('returns ok with the result on success', async () => {
    const seam = { query: async () => ({ kind: 'diagnostics', diagnostics: [] }) } as unknown as SeamService
    const attempt = await trySeamAction(seam, 'diagnostics', 'a.ts', '/ws', undefined, undefined)
    expect(attempt).toEqual({ ok: true, result: { kind: 'diagnostics', diagnostics: [] } })
  })

  it('classifies LSP_UNAVAILABLE as fallback-unavailable', async () => {
    const seam = { query: async () => { throw codedError('no provider', 'LSP_UNAVAILABLE') } } as unknown as SeamService
    expect(await trySeamAction(seam, 'diagnostics', 'a.ts', '/ws', undefined, undefined)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('classifies LSP_UNSUPPORTED_OPERATION as fail-loud unsupported', async () => {
    const seam = { query: async () => { throw codedError('nope', 'LSP_UNSUPPORTED_OPERATION') } } as unknown as SeamService
    expect(await trySeamAction(seam, 'diagnostics', 'a.ts', '/ws', undefined, undefined)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('classifies a code-less failure as a legacy seam', async () => {
    const seam = { query: async () => { throw new Error('unreachable operation') } } as unknown as SeamService
    expect(await trySeamAction(seam, 'diagnostics', 'a.ts', '/ws', undefined, undefined)).toEqual({ ok: false, reason: 'legacy' })
  })

  it('rethrows an unrelated structured seam failure', async () => {
    const failure = codedError('malformed', 'LSP_MALFORMED_RESPONSE')
    const seam = { query: async () => { throw failure } } as unknown as SeamService
    const attempt = await trySeamAction(seam, 'diagnostics', 'a.ts', '/ws', undefined, undefined)
    expect(attempt).toEqual({ ok: false, reason: 'error', error: failure })
  })

  it('rethrows the caller abort instead of classifying it', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    const seam = { query: async () => { throw codedError('x', 'LSP_UNAVAILABLE') } } as unknown as SeamService
    await expect(trySeamAction(seam, 'diagnostics', 'a.ts', '/ws', undefined, undefined, controller.signal)).rejects.toThrow('stopped')
  })

  it('forwards operation-specific extras (query, onlyKinds, newName) to the seam query', async () => {
    const seen: unknown[] = []
    const seam = {
      query: async (queryRequest: unknown) => {
        seen.push(queryRequest)
        return { kind: 'symbols', items: [] }
      },
    } as unknown as SeamService
    await trySeamAction(seam, 'workspaceSymbol', 'a.ts', '/ws', undefined, undefined, undefined, { query: 'findMe' })
    expect(seen[0]).toEqual({
      operation: 'workspaceSymbol', filePath: 'a.ts', workspaceRoot: '/ws', query: 'findMe',
    })
    await trySeamAction(seam, 'codeAction', 'a.ts', '/ws', undefined, undefined, undefined, { onlyKinds: ['quickfix'] })
    expect(seen[1]).toEqual({
      operation: 'codeAction', filePath: 'a.ts', workspaceRoot: '/ws', onlyKinds: ['quickfix'],
    })
    await trySeamAction(seam, 'rename', 'a.ts', '/ws', { line: 0, character: 0 }, undefined, undefined, { newName: 'next' })
    expect(seen[2]).toEqual({
      operation: 'rename', filePath: 'a.ts', workspaceRoot: '/ws', position: { line: 0, character: 0 }, newName: 'next',
    })
  })

  it('omits absent extras from the seam query request', async () => {
    const seen: unknown[] = []
    const seam = {
      query: async (queryRequest: unknown) => {
        seen.push(queryRequest)
        return { kind: 'diagnostics', diagnostics: [] }
      },
    } as unknown as SeamService
    await trySeamAction(seam, 'diagnostics', 'a.ts', '/ws', undefined, undefined)
    expect(seen[0]).toEqual({ operation: 'diagnostics', filePath: 'a.ts', workspaceRoot: '/ws' })
  })
})

describe('probeSeamVintage (the asserted seam-vintage invariant)', () => {
  it("answers 'absent' when no seam is mounted", async () => {
    expect(await probeSeamVintage(undefined, 'a.ts', '/ws')).toBe('absent')
  })

  it("answers 'legacy' for a four-operation seam that rejects an action with a code-less error", async () => {
    const seen: unknown[] = []
    const seam = {
      query: async (queryRequest: unknown) => {
        seen.push(queryRequest)
        throw new Error('unreachable operation')
      },
    } as unknown as SeamService
    expect(await probeSeamVintage(seam, 'a.ts', '/ws')).toBe('legacy')
    // The probe uses documentSymbol: path-only, so it neither demands a position nor walks a range.
    expect(seen[0]).toEqual({ operation: 'documentSymbol', filePath: 'a.ts', workspaceRoot: '/ws' })
  })

  it("answers 'unsupported' when the seam knows the vocabulary but declines the operation", async () => {
    const seam = {
      query: async () => { throw Object.assign(new Error('no provider'), { code: 'LSP_UNSUPPORTED_OPERATION' }) },
    } as unknown as SeamService
    expect(await probeSeamVintage(seam, 'a.ts', '/ws')).toBe('unsupported')
  })

  it("answers 'actions' when the seam serves the probe", async () => {
    const seam = { query: async () => ({ kind: 'documentSymbol', symbols: [] }) } as unknown as SeamService
    expect(await probeSeamVintage(seam, 'a.ts', '/ws')).toBe('actions')
  })

  it("answers 'actions' when the seam understands the vocabulary and reports the file unavailable", async () => {
    const seam = {
      query: async () => { throw Object.assign(new Error('no provider for file'), { code: 'LSP_UNAVAILABLE' }) },
    } as unknown as SeamService
    expect(await probeSeamVintage(seam, 'a.ts', '/ws')).toBe('actions')
  })

  it('classifySeamAttempt maps every attempt reason onto its vintage', () => {
    expect(classifySeamAttempt({ ok: true, result: { kind: 'diagnostics', diagnostics: [] } })).toBe('actions')
    expect(classifySeamAttempt({ ok: false, reason: 'legacy' })).toBe('legacy')
    expect(classifySeamAttempt({ ok: false, reason: 'unsupported' })).toBe('unsupported')
    expect(classifySeamAttempt({ ok: false, reason: 'unavailable' })).toBe('actions')
    expect(classifySeamAttempt({ ok: false, reason: 'error', error: new Error('x') })).toBe('actions')
  })
})
