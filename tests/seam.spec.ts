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
})
