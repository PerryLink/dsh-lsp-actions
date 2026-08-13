/**
 * A real subprocess adapter for tests: implements the subprocess seam's handle contract over
 * `node:child_process`, so client and end-to-end tests exercise genuine processes, protocol
 * framing, and tree termination without mounting the full harness.
 */

import { spawn } from 'node:child_process'
import { delimiter } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { accessSync, constants } from 'node:fs'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/** One retained-tail collector with offset-based reads, mirroring the seam's collect semantics. */
class TailCollector implements SubprocessOutputReader {
  private retained = Buffer.alloc(0)
  private totalBytes = 0

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    this.totalBytes += chunk.length
    this.retained = Buffer.concat([this.retained, chunk])
    if (this.retained.length > this.maxBytes) {
      this.retained = this.retained.subarray(this.retained.length - this.maxBytes)
    }
  }

  readFrom(fromByte: number): { text: string; nextOffset: number; lossy: boolean; spillPath?: string } {
    const windowStart = Math.max(0, this.totalBytes - this.maxBytes)
    const lossy = fromByte < windowStart
    const start = lossy ? windowStart : fromByte
    const text = this.retained.subarray(start - windowStart).toString('utf8')
    return { text, nextOffset: this.totalBytes, lossy }
  }
}

/**
 * Spawn one subprocess exactly as the subprocess seam would: explicit per-stream dispositions,
 * collected stderr tails, and a kill that terminates the whole tree.
 * @param spec - the fully-specified spawn request.
 * @returns the live handle.
 */
export function spawnForTest(spec: SubprocessSpawnSpec): SubprocessHandle {
  const stdinMode = spec.stdio.stdin
  const stdoutMode = spec.stdio.stdout
  const stderrMode = spec.stdio.stderr
  const stdio: Array<'pipe' | 'inherit' | 'ignore'> = [
    stdinMode === 'pipe' ? 'pipe' : 'ignore',
    stdoutMode === 'pipe' ? 'pipe' : stdoutMode === 'inherit' ? 'inherit' : 'pipe',
    stderrMode === 'pipe' ? 'pipe' : stderrMode === 'inherit' ? 'inherit' : 'pipe',
  ]
  const child = spawn(spec.argv[0] as string, spec.argv.slice(1) as string[], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio,
    windowsHide: true,
  })
  const stdoutCollector = typeof stdoutMode === 'object' ? new TailCollector(stdoutMode.maxBytes) : undefined
  const stderrCollector = typeof stderrMode === 'object' ? new TailCollector(stderrMode.maxBytes) : undefined
  if (stdoutCollector !== undefined) child.stdout?.on('data', (chunk: Buffer) => { stdoutCollector.push(chunk) })
  if (stderrCollector !== undefined) child.stderr?.on('data', (chunk: Buffer) => { stderrCollector.push(chunk) })

  if (typeof stdinMode === 'object') {
    child.stdin?.end(stdinMode.data)
  }

  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    child.once('error', (error) => { reject(error) })
    child.once('close', (exitCode, signal) => { resolve({ exitCode, signal: signal as NodeJS.Signals | null }) })
  })
  // A spawn-level failure must reject the outcome; a rejection needs no unhandled-rejection noise.
  done.catch(() => {})

  const terminate = (): void => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        process.kill(-child.pid, 'SIGKILL')
      }
    } catch {
      // The tree may already be gone; the close event is authoritative.
    }
  }

  spec.signal?.addEventListener('abort', terminate, { once: true })

  return {
    pid: child.pid ?? -1,
    stdin: child.stdin as Writable | undefined,
    stdout: stdoutMode === 'pipe' ? (child.stdout as Readable) : undefined,
    stderr: stderrMode === 'pipe' ? (child.stderr as Readable) : undefined,
    collected: {
      ...stdoutCollector === undefined ? {} : { stdout: stdoutCollector },
      ...stderrCollector === undefined ? {} : { stderr: stderrCollector },
    },
    done,
    terminate,
    async waitForExit(signal?: AbortSignal): Promise<boolean> {
      if (signal === undefined) {
        await done
        return true
      }
      const aborted = new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false)
          return
        }
        signal.addEventListener('abort', () => { resolve(false) }, { once: true })
      })
      return await Promise.race([done.then(() => true), aborted])
    },
  }
}

/**
 * Resolve an executable the way the subprocess seam does: an existing absolute path passes
 * through; a bare command is looked up on `PATH` (with Windows shim extensions).
 * @param command - the command to resolve.
 * @returns the absolute executable path.
 * @throws Error when the command does not exist.
 */
export function resolveExecutableForTest(command: string): string {
  const candidates = [command]
  if (!command.includes('/') && !command.includes('\\')) {
    const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(segment => segment !== '')
    const extensions = process.platform === 'win32' ? ['', '.EXE', '.CMD', '.BAT'] : ['']
    for (const dir of pathEntries) {
      for (const extension of extensions) {
        candidates.push(`${dir}\\${command}${extension}`, `${dir}/${command}${extension}`)
      }
    }
  }
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not this candidate.
    }
  }
  throw new Error(`executable "${command}" was not found on PATH`)
}
