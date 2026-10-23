import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { LspActionInstance } from '../src/client.ts'
import { LspConnection } from '../src/connection.ts'

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


it('bounds a teardown whose process-tree observation never settles', async () => {
  let terminated = false
  let settle!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>((resolve) => { settle = resolve })
  const handle = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: undefined,
    control: undefined,
    collected: { stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
    done,
    terminate: () => { terminated = true; settle({ exitCode: 0, signal: null }) },
    waitForExit: (signal?: AbortSignal) => new Promise<boolean>((resolve) => { signal?.addEventListener('abort', () => resolve(false), { once: true }) }),
  } as unknown as SubprocessHandle
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
    killGraceMs: 20,
    shutdownTimeoutMs: 20,
    diagnosticsSettleMs: 10,
    diagnosticsDebounceMs: 10,
    idleTimeoutMs: 0,
  }, () => handle)
  await expect(instance.dispose()).rejects.toThrow(/did not confirm exit/u)
  expect(terminated).toBe(true)
})

it('terminates the handle when the connection rejects a missing piped stream', () => {
  let terminated = false
  const handle = {
    stdin: new PassThrough(),
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {},
    done: new Promise(() => {}),
    terminate: () => { terminated = true },
    waitForExit: async () => true,
  } as unknown as SubprocessHandle
  expect(() => new LspConnection({
    command: process.execPath,
    args: [],
    cwd: process.cwd(),
    env: {},
    maxMessageBytes: 1024,
    maxStderrBytes: 1024,
    killGraceMs: 10,
    configuration: {},
  }, () => handle, async () => null)).toThrow(/dropped a piped protocol stream/u)
  expect(terminated).toBe(true)
})
