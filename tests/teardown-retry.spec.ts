import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { LspActionInstance } from '../src/client.ts'

/** A fake handle whose tree observation fails once, then succeeds. */
function flakyHandle(): SubprocessHandle {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let settle!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>((resolve) => { settle = resolve })
  let waits = 0
  return {
    stdin,
    stdout,
    stderr: undefined,
    control: undefined,
    collected: {
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done,
    terminate: () => { settle({ exitCode: 0, signal: null }) },
    waitForExit: async () => {
      waits += 1
      if (waits === 1) throw new Error('provider lost range observation')
      return true
    },
  } as unknown as SubprocessHandle
}

describe('LspActionInstance teardown', () => {
  it('clears a rejected teardown promise so dispose can retry', async () => {
    const handle = flakyHandle()
    const instance = new LspActionInstance({
      executable: process.execPath,
      args: [],
      cwd: process.cwd(),
      workspaceUri: 'file:///tmp/workspace',
      env: {},
      configuration: {},
      initializationOptions: undefined,
      formattingOptions: undefined,
      maxMessageBytes: 1024 * 1024,
      maxStderrBytes: 1024,
      killGraceMs: 10,
      shutdownTimeoutMs: 20,
      diagnosticsSettleMs: 10,
      diagnosticsDebounceMs: 10,
      idleTimeoutMs: 0,
    }, () => handle)

    await expect(instance.dispose()).rejects.toThrow('provider lost range observation')
    await expect(instance.dispose()).resolves.toBeUndefined()
  })
})
