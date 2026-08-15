import { describe, expect, it } from 'vitest'
import { trySeamAction } from '../src/seam.ts'
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
