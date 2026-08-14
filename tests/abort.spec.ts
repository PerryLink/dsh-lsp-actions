import { describe, expect, it } from 'vitest'
import { abortable } from '../src/abort.ts'

describe('abortable', () => {
  it('returns the same promise when no signal is given', async () => {
    const promise = Promise.resolve(1)
    expect(abortable(promise, undefined)).toBe(promise)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already'))
    await expect(abortable(Promise.resolve(1), controller.signal)).rejects.toThrow('already')
  })

  it('passes the value through when the promise settles before an abort', async () => {
    const controller = new AbortController()
    await expect(abortable(Promise.resolve('ok'), controller.signal)).resolves.toBe('ok')
    controller.abort(new Error('late'))
  })

  it('rejects with the signal reason when aborted mid-flight', async () => {
    const controller = new AbortController()
    const pending = new Promise<void>(() => {})
    const raced = abortable(pending, controller.signal)
    const rejection = expect(raced).rejects.toThrow('stopped')
    controller.abort(new Error('stopped'))
    await rejection
  })

  it('propagates the underlying rejection when the signal never aborts', async () => {
    const controller = new AbortController()
    await expect(abortable(Promise.reject(new Error('boom')), controller.signal)).rejects.toThrow('boom')
  })
})
