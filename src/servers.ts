/**
 * Server configuration and routing: the `servers` table schema, load-time validation and
 * executable resolution, and the per-file routing that picks one server entry (glob patterns
 * first, then the extension map) plus its language id.
 * @module dsh-lsp-actions/servers
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { finalExtension } from './extension.ts'

/** Node's largest schedulable timer, the upper bound for every timeout-shaped config field. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

const DEFAULT_MAX_MESSAGE_BYTES = 16_000_000
const DEFAULT_MAX_STDERR_BYTES = 1_000_000
/** The default byte cap for any single source document a tool opens for a language server. */
export const DEFAULT_MAX_DOCUMENT_BYTES = 4_000_000
const DEFAULT_KILL_GRACE_MS = 2_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
const DEFAULT_DIAGNOSTICS_SETTLE_MS = 2_000
const DEFAULT_DIAGNOSTICS_DEBOUNCE_MS = 250
const DEFAULT_IDLE_TIMEOUT_MS = 0

/** One configured local language server and its host bounds. */
export interface LspServerEntry {
  /** Executable to spawn (absolute, or resolved on PATH at load). */
  command: string
  /** Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). */
  extensionToLanguage: Record<string, string>
  /** Optional path globs (e.g. `src/**\/*.ts`); when a file matches, this entry wins over the extension map. */
  fileGlobs?: string[]
  /** Arguments passed to the executable (no shell). Default `[]`. */
  args?: string[]
  /** Extra env vars merged on top of the scrubbed ambient env. Default `{}`. */
  env?: Record<string, string>
  /** Static `initialize` options forwarded to the server. Default `null`. */
  initializationOptions?: unknown
  /** Static answer to every `workspace/configuration` item. Default `null`. */
  configuration?: unknown
  /** Static `textDocument/formatting` options (`{ tabSize, insertSpaces }`); omitted when null. Default `null`. */
  formattingOptions?: unknown
  /** Largest single framed message accepted from the server (bytes). Default 16000000. */
  maxMessageBytes?: number
  /** Largest stderr tail retained for diagnostics (bytes). Default 1000000. */
  maxStderrBytes?: number
  /** Request-cancel and SIGTERM→SIGKILL grace (ms). Default 2000. */
  killGraceMs?: number
  /** Graceful `shutdown`/`exit` budget before escalation (ms). Default 5000. */
  shutdownTimeoutMs?: number
  /** Settle window for push-only diagnostics after `didOpen` (ms). Default 2000. */
  diagnosticsSettleMs?: number
  /** Quiet period after the last pushed batch before the client returns it (ms). Default 250. */
  diagnosticsDebounceMs?: number
  /** Idle time before an unused server instance is disposed (ms); 0 keeps it alive. Default 0. */
  idleTimeoutMs?: number
}

/** Plugin configuration: a named table of local language servers plus tool result caps. */
export interface Config {
  /** Named server entries; empty disables the plugin's own client (the official seam may still serve). */
  servers: Record<string, LspServerEntry>
  /** Largest number of rendered diagnostics before an omission marker. Default 200. */
  maxDiagnostics?: number
  /** Largest number of rendered completion items before an omission marker. Default 20. */
  maxCompletionItems?: number
  /** Largest number of rendered code actions before an omission marker. Default 50. */
  maxCodeActions?: number
  /** Largest number of rendered symbols before an omission marker. Default 100. */
  maxSymbols?: number
  /** Largest number of rendered signatures in one signature-help result. Default 10. */
  maxSignatures?: number
  /** Largest number of rendered inlay hints before an omission marker. Default 200. */
  maxInlayHints?: number
  /** Largest complete rendered result in characters, including truncation metadata. Default 16000. */
  maxResultChars?: number
  /** Largest source file a tool will open for a language server (bytes). Default 4000000. */
  maxDocumentBytes?: number
  /** Tool-call timeout budget in ms, enforced by the official timeout policy. Default 60000. */
  timeoutMs?: number
}

export const LspServerEntry: z<LspServerEntry> = z.object({
  command: z.string().required(),
  extensionToLanguage: z.dict(String).required(),
  fileGlobs: z.array(String).default([]),
  args: z.array(String).default([]),
  env: z.dict(String).default({}),
  initializationOptions: z.any().default(null),
  configuration: z.any().default(null),
  formattingOptions: z.any().default(null),
  maxMessageBytes: z.number().default(DEFAULT_MAX_MESSAGE_BYTES),
  maxStderrBytes: z.number().default(DEFAULT_MAX_STDERR_BYTES),
  killGraceMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_KILL_GRACE_MS),
  shutdownTimeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  diagnosticsSettleMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_DIAGNOSTICS_SETTLE_MS),
  diagnosticsDebounceMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_DIAGNOSTICS_DEBOUNCE_MS),
  idleTimeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_IDLE_TIMEOUT_MS),
})

export const Config: z<Config> = z.object({
  servers: z.dict(LspServerEntry).default({}),
  maxDiagnostics: z.number().default(200),
  maxCompletionItems: z.number().default(20),
  maxCodeActions: z.number().default(50),
  maxSymbols: z.number().default(100),
  maxSignatures: z.number().default(10),
  maxInlayHints: z.number().default(200),
  maxResultChars: z.number().default(16_000),
  maxDocumentBytes: z.number().default(DEFAULT_MAX_DOCUMENT_BYTES),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(60_000),
})

/** One server entry after schemastery filled every default. */
export type ResolvedServerEntry = Required<LspServerEntry>

/** The plugin config after schemastery filled every default. */
export type ResolvedConfig = Required<Config>

/** One resolved, executable server plus its routing. */
export interface ResolvedServer {
  /** The entry's stable key in the `servers` table. */
  readonly serverId: string
  /** The entry with every default filled and validated. */
  readonly entry: ResolvedServerEntry
  /** The absolute executable resolved at load. */
  readonly executable: string
}

/** The route one file selects: which server and what language id to open it with. */
export interface ServerRoute {
  readonly server: ResolvedServer
  readonly languageId: string
}

/**
 * Resolve every server entry's executable at load (fail loud on a missing command or an invalid
 * bound) before any provider publishes. Mirrors the official `lsp-stdio` load contract.
 * @param ctx - the plugin context (uses `ctx.subprocess.resolveExecutable`).
 * @param servers - the schemastery-resolved servers table.
 * @param signal - load cancellation.
 * @returns the resolved servers in config order.
 */
export async function resolveServers(
  ctx: Context,
  servers: Record<string, ResolvedServerEntry>,
  signal?: AbortSignal,
): Promise<ResolvedServer[]> {
  const resolved: ResolvedServer[] = []
  for (const [serverId, entry] of Object.entries(servers)) {
    if (serverId.trim() === '') throw new Error('lsp-actions: server ids must be non-empty strings')
    validateServerEntry(serverId, entry)
    for (const glob of entry.fileGlobs) {
      globToRegExp(glob) // throws on a malformed pattern at load, not at routing time
    }
    const executable = await ctx.subprocess.resolveExecutable(entry.command, entry.env, signal)
    resolved.push({ serverId, entry, executable })
  }
  return resolved
}

/**
 * Route one file to a server entry: entries with matching `fileGlobs` first, then entries whose
 * `extensionToLanguage` maps the file's extension, both in config order. A glob route uses the
 * file's own extension mapping when the entry maps it; the entry's first mapping is the fallback
 * only for files whose extension the glob — not the map — selected.
 * @param servers - the resolved servers.
 * @param filePath - the source file path (absolute or workspace-relative).
 * @returns the route, or undefined when no entry handles the file.
 */
export function routeFile(servers: readonly ResolvedServer[], filePath: string): ServerRoute | undefined {
  const normalized = filePath.replaceAll('\\', '/')
  const extension = finalExtension(filePath)
  for (const server of servers) {
    for (const glob of server.entry.fileGlobs) {
      if (globToRegExp(glob).test(normalized)) {
        const languageId = server.entry.extensionToLanguage[extension] ?? firstLanguageId(server)
        return { server, languageId }
      }
    }
  }
  for (const server of servers) {
    const languageId = server.entry.extensionToLanguage[extension]
    if (languageId !== undefined) return { server, languageId }
  }
  return undefined
}

/** The first extension mapping's language id, used when a glob route wins without an extension hit. */
export function firstLanguageId(server: ResolvedServer): string {
  const languageId = Object.values(server.entry.extensionToLanguage)[0]
  if (languageId === undefined) throw new Error(`lsp-actions: server "${server.serverId}" maps no extensions`)
  return languageId
}

/**
 * Compile a path glob (`*`/`**`/`?`) to an anchored regular expression. `*` and `?` do not cross
 * separators; `**` does. Matching runs against `/`-normalized paths.
 * @param pattern - the glob pattern.
 * @returns the compiled, anchored expression.
 * @throws Error when the pattern is empty or contains unbalanced brackets.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '^'
  let i = 0
  const push = (text: string): void => {
    source += text.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  while (i < pattern.length) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // A lone `**` spans path separators; `**/` also matches zero directories.
        if (pattern[i + 2] === '/') {
          source += '(?:[^/]+/)*'
          i += 3
        } else {
          source += '.*'
          i += 2
        }
        continue
      }
      source += '[^/]*'
      i += 1
      continue
    }
    if (char === '?') {
      source += '[^/]'
      i += 1
      continue
    }
    if (char === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close < 0) throw new Error(`lsp-actions: unbalanced "[" in fileGlob "${pattern}"`)
      source += pattern.slice(i, close + 1)
      i = close + 1
      continue
    }
    push(char)
    i += 1
  }
  source += '$'
  if (source === '^$') throw new Error('lsp-actions: fileGlob patterns must be non-empty')
  return new RegExp(source)
}

/** Reject config values that would fail later (nonpositive caps, invalid timers) at load. */
function validateServerEntry(serverId: string, entry: ResolvedServerEntry): void {
  assertServerTimer(serverId, 'killGraceMs', entry.killGraceMs)
  assertServerTimer(serverId, 'shutdownTimeoutMs', entry.shutdownTimeoutMs)
  assertServerTimer(serverId, 'diagnosticsSettleMs', entry.diagnosticsSettleMs)
  assertServerTimer(serverId, 'diagnosticsDebounceMs', entry.diagnosticsDebounceMs)
  assertServerNonnegativeInteger(serverId, 'idleTimeoutMs', entry.idleTimeoutMs)
  assertServerPositiveInteger(serverId, 'maxMessageBytes', entry.maxMessageBytes)
  assertServerPositiveInteger(serverId, 'maxStderrBytes', entry.maxStderrBytes)
  const extensions = Object.entries(entry.extensionToLanguage)
  if (extensions.length === 0) {
    throw new Error(`lsp-actions: servers.${serverId} must map at least one extension`)
  }
  for (const [extension, languageId] of extensions) {
    const normalized = normalizeExtension(extension)
    if (!/^\.[^./\\]+$/.test(normalized)) {
      throw new Error(`lsp-actions: servers.${serverId} maps an invalid extension "${extension}"`)
    }
    if (languageId.trim() === '') {
      throw new Error(`lsp-actions: servers.${serverId} maps extension "${extension}" to an empty language id`)
    }
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
export function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`lsp-actions: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Reject a nonpositive or non-integer config value at load. */
export function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`lsp-actions: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertServerTimer(serverId: string, name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`lsp-actions: servers.${serverId}.${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Reject a nonpositive or non-integer config value at load. */
function assertServerPositiveInteger(serverId: string, name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`lsp-actions: servers.${serverId}.${name} must be a positive integer`)
  }
}

/** Reject a negative or non-integer config value at load (zero is a valid "disabled" value). */
function assertServerNonnegativeInteger(serverId: string, name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`lsp-actions: servers.${serverId}.${name} must be a nonnegative integer`)
  }
}

/** Lowercase an extension and ensure it carries a leading dot. */
function normalizeExtension(extension: string): string {
  const lower = extension.toLowerCase()
  return lower.startsWith('.') ? lower : `.${lower}`
}
