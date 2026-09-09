/**
 * The connection's dependency on the subprocess-handle contract. dsh
 * `0.1.5-alpha.1` deleted `SubprocessHandle.pid`, so the plugin dropped its
 * matching accessor; these tests pin that no code path reads a removed member
 * and that the retained diagnostics surface (stderr tail, failure flag, tree
 * termination) still works. No real language server is spawned.
 */

import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { LspConnection, type ConnectionSpec } from '../src/connection.ts'

/** The connection spec the tests build on. */
function connectionSpec(): ConnectionSpec {
  return {
    command: process.execPath,
    args: [],
    cwd: process.cwd(),
    env: {},
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 1_000,
    killGraceMs: 1_000,
    configuration: null,
  }
}

interface FakeHandle {
  readonly handle: SubprocessHandle
  readonly reads: string[]
  readonly terminations: () => number
  readonly finish: () => void
}

/** A handle shaped like the 0.1.5 contract that fails loudly on a removed member read. */
function fakeHandle(): FakeHandle {
  const reads: string[] = []
  let terminations = 0
  let settle: (outcome: SubprocessOutcome) => void = () => {}
  const target = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: undefined,
    collected: {
      stderr: {
        readFrom: (fromByte: number) => {
          reads.push(String(fromByte))
          return { text: 'boom: server died\n', nextOffset: 18, lossy: false }
        },
      },
    },
    done: new Promise<SubprocessOutcome>((resolve) => { settle = resolve }),
    terminate: (): void => { terminations += 1 },
    waitForExit: async (): Promise<boolean> => true,
  }
  const handle = new Proxy(target as unknown as SubprocessHandle, {
    get(inner, property, receiver) {
      if (property === 'pid') throw new Error('read of the removed SubprocessHandle.pid')
      return Reflect.get(inner, property, receiver) as unknown
    },
  })
  return {
    handle,
    reads,
    terminations: () => terminations,
    finish: () => { settle({ exitCode: 0, signal: null }) },
  }
}

describe('LspConnection against the 0.1.5 subprocess contract', () => {
  it('never reads the removed SubprocessHandle.pid member', () => {
    const fake = fakeHandle()
    const connection = new LspConnection(connectionSpec(), () => fake.handle, async () => null)
    expect('pid' in connection).toBe(false)
    connection.terminate()
    expect(fake.terminations()).toBe(1)
    fake.finish()
  })

  it('keeps the retained stderr tail and failure flag as the process diagnostics', async () => {
    const fake = fakeHandle()
    const connection = new LspConnection(connectionSpec(), () => fake.handle, async () => null)
    expect(connection.failed).toBe(false)
    expect(connection.stderrTail).toBe('boom: server died\n')
    expect(fake.reads).toEqual(['0'])
    expect(await connection.waitForProcessTreeExit()).toBe(true)
    fake.finish()
    await connection.closed
  })
})
