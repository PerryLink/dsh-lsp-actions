/**
 * LSP action surface for DeepSeek Harness: `lsp_diagnostics`, `lsp_format`, and `lsp_completion`
 * tools over language servers. Actions go through the extended official `ctx.lsp` seam when it is
 * mounted (the upstream PR proposal); otherwise the plugin's own minimal stdio client serves them
 * from the `servers` table, resolved and validated at load. With an empty servers table and no
 * seam, the plugin contributes nothing.
 *
 * Namespace plugin (named exports, no default export).
 * @module dsh-lsp-actions
 */

import type { Context } from '@deepseek-ai/cordis'
import { LspActionClient } from './client.ts'
import { createActionRunner } from './runner.ts'
import { FormatSandboxController } from './sandbox.ts'
import type { SeamService } from './seam.ts'
import { assertPositiveInteger, assertTimer, Config as ConfigSchema, resolveServers } from './servers.ts'
import type { Config as ConfigType, ResolvedConfig, ResolvedServerEntry } from './servers.ts'
import { registerCompletionTool, registerDiagnosticsTool, registerFormatTool } from './tools.ts'

export { LspServerEntry } from './servers.ts'
export { LspActionClient } from './client.ts'
export { LspActionError } from './vocabulary.ts'
export type {
  LspActionErrorCode,
  LspActionResult,
  LspCompletionItem,
  LspDiagnostic,
  LspDiagnosticSeverity,
  LspPosition,
  LspRange,
  LspTextEdit,
} from './vocabulary.ts'
export { applyEdits } from './edits.ts'
export { encodeMessage, MessageDecoder } from './framing.ts'
export {
  formatAppliedEdits,
  formatCompletionList,
  formatDiagnostics,
  presentLspCompletionCall,
  presentLspCompletionResult,
  presentLspDiagnosticsCall,
  presentLspDiagnosticsResult,
  presentLspFormatCall,
  presentLspFormatResult,
} from './render.ts'
export {
  globToRegExp,
  routeFile,
  resolveServers,
} from './servers.ts'
export {
  normalizeCompletionItems,
  normalizeDiagnostics,
  normalizeEdits,
  negotiatePositionEncoding,
  requestMethod,
  supportsAction,
  supportsPullDiagnostics,
  supportsTransientOpen,
} from './translate.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'lsp-actions'

/** Services required by this plugin. */
export const inject = ['tools', 'fs', 'subprocess']

/** Plugin configuration schema (schemastery fills every default; misconfiguration fails at load). */
export const Config = ConfigSchema

/**
 * Register the three LSP action tools. Resolves every configured server executable at load (fail
 * loud on a missing command) before registering anything; tool, client, and server lifecycles are
 * effect-scoped, so disposal unregisters the tools and tears down every live server.
 * @param ctx - the plugin context (must inject `tools`, `fs`, `subprocess`).
 * @param config - the resolved plugin configuration.
 */
export async function apply(ctx: Context, config: ConfigType): Promise<void> {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxDiagnostics', resolved.maxDiagnostics)
  assertPositiveInteger('maxCompletionItems', resolved.maxCompletionItems)
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertPositiveInteger('maxDocumentBytes', resolved.maxDocumentBytes)
  assertTimer('timeoutMs', resolved.timeoutMs)

  // `ctx.lsp` is an optional capability: typed required by the seam package, absent at runtime in
  // compositions without a provider. Consume it structurally, never by import.
  const seam = ctx.get('lsp') as unknown as SeamService | undefined
  const serverEntries = Object.entries(resolved.servers)
  if (serverEntries.length === 0 && seam === undefined) return

  // Resolve every executable BEFORE registering anything: a bad later command must not publish an
  // earlier tool, matching the official lsp-stdio load contract.
  const servers = await resolveServers(ctx, resolved.servers as Record<string, ResolvedServerEntry>)
  const sandbox = new FormatSandboxController(ctx)
  const client = new LspActionClient(ctx.subprocess, ctx.fs)
  const runner = createActionRunner({ seam, client, servers })

  ctx.effect(() => {
    registerDiagnosticsTool(ctx, runner, resolved)
    registerCompletionTool(ctx, runner, resolved)
    registerFormatTool(ctx, runner, sandbox, resolved)
    return async () => {
      await client.disposeAll()
    }
  }, 'lsp-actions.registerTools')
}
