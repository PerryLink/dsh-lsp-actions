/**
 * Abort helpers: race any promise against a signal, and throw the signal's reason once it fires.
 * @module dsh-lsp-actions/abort
 */

/**
 * Race `promise` against `signal`; the returned promise rejects with the signal's reason the
 * moment it aborts, without disturbing the underlying promise's own settlement.
 * @param promise - the work to race.
 * @param signal - optional cancellation; undefined returns the promise unchanged.
 * @returns the raced promise.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
