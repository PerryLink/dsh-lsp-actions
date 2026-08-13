/**
 * Derive the workspace root an LSP action call resolves against: the calling agent's per-session
 * workspace (`exec.agent.session.header.cwd`), mirroring how the filesystem and navigation tools
 * resolve paths. There is no fallback — a missing cwd fails the call, because a language server
 * must be rooted in a real workspace.
 * @module dsh-lsp-actions/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller.
 */
export function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}
