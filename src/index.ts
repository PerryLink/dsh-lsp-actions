/**
 * LSP action surface for DeepSeek Harness: diagnostics, formatting, completion, code actions,
 * symbols, signature help, inlay hints, and rename tools over language servers. Actions go through
 * the extended official `ctx.lsp` seam when it is mounted (the upstream PR proposal); otherwise
 * the plugin's own minimal stdio client serves them from the `servers` table, resolved and
 * validated at load. With an empty servers table and no seam, the tools are still registered and
 * fail loudly with `LSP_ACTION_UNAVAILABLE` on use — the seam is resolved per call, so a seam
 * mounted after this plugin is served without a reload.
 *
 * Namespace plugin (named exports, no default export).
 * @module dsh-lsp-actions
 */

import type { Context } from '@deepseek-ai/cordis'
import { LspActionClient } from './client.ts'
import { registerCodeActionTool, registerInlayHintsTool, registerSignatureTool, registerSymbolsTool } from './extra-tools.ts'
import { startEditorProtocol } from './editor/server.ts'
import { createActionRunner } from './runner.ts'
import { FormatSandboxController } from './sandbox.ts'
import type { SeamService } from './seam.ts'
import { assertPositiveInteger, assertTimer, Config as ConfigSchema, resolveServers } from './servers.ts'
import type { Config as ConfigType, ResolvedConfig, ResolvedServerEntry } from './servers.ts'
import { registerCompletionTool, registerDiagnosticsTool, registerFormatTool, registerRenameTool } from './tools.ts'

export { LspServerEntry } from './servers.ts'
export { LspActionClient } from './client.ts'
export { LspActionError } from './vocabulary.ts'
export type {
  LspActionErrorCode,
  LspActionResult,
  LspCodeActionItem,
  LspCodeActionsResult,
  LspCompletionItem,
  LspDiagnostic,
  LspDiagnosticSeverity,
  LspDiagnosticsResult,
  LspEditsResult,
  LspInlayHint,
  LspInlayHintsResult,
  LspPosition,
  LspRange,
  LspRenameResult,
  LspSignature,
  LspSignaturesResult,
  LspSymbol,
  LspSymbolsResult,
  LspTextEdit,
} from './vocabulary.ts'
export { applyEdits } from './edits.ts'
export { LruDiagnosticsCache } from './editor/cache.ts'
export { EditorActionService } from './editor/service.ts'
export { EditorJsonRpcServer, EDITOR_METHOD_EVENTS, EDITOR_METHOD_LIST, EDITOR_METHOD_RUN } from './editor/server.ts'
export type { EditorServerOptions } from './editor/server.ts'
export type {
  EditorActionDescriptor,
  EditorActionId,
  EditorActionResult,
  EditorCompletionParams,
  EditorDiagnostic,
  EditorDiagnosticsParams,
  EditorErrorInfo,
  EditorEvent,
  EditorFormatParams,
  EditorListResult,
  EditorQuickfixParams,
  EditorRunRequest,
  EditorRunResult,
  EditorSessionInfo,
} from './editor/types.ts'
export { EDITOR_PROTOCOL } from './editor/types.ts'
export { encodeMessage, MessageDecoder } from './framing.ts'
export {
  formatAppliedEdits,
  formatCodeActions,
  formatCompletionList,
  formatDiagnostics,
  formatInlayHints,
  formatRenameResult,
  formatSignatures,
  formatSymbols,
  presentLspCodeActionCall,
  presentLspCodeActionResult,
  presentLspCompletionCall,
  presentLspCompletionResult,
  presentLspDiagnosticsCall,
  presentLspDiagnosticsResult,
  presentLspFormatCall,
  presentLspFormatResult,
  presentLspInlayHintsCall,
  presentLspInlayHintsResult,
  presentLspRenameCall,
  presentLspRenameResult,
  presentLspSignatureCall,
  presentLspSignatureResult,
  presentLspSymbolsCall,
  presentLspSymbolsResult,
  symbolKindLabel,
} from './render.ts'
export {
  globToRegExp,
  routeFile,
  resolveServers,
} from './servers.ts'
export {
  decodeTextEdits,
  negotiatePositionEncoding,
  normalizeCodeActions,
  normalizeCompletionItems,
  normalizeDiagnostics,
  normalizeEdits,
  normalizeInlayHints,
  normalizeSignatures,
  normalizeSymbols,
  normalizeWorkspaceEdit,
  PositionCodec,
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
 * Register the eight LSP action tools. Resolves every configured server executable at load (fail
 * loud on a missing command) before registering anything; tool, client, and server lifecycles are
 * effect-scoped, so disposal unregisters the tools and tears down every live server. The official
 * seam is resolved lazily per call (see the runner), so registration is independent of the seam's
 * load order; without servers and without a seam, calls fail loudly with `LSP_ACTION_UNAVAILABLE`
 * instead of the plugin silently contributing nothing.
 * @param ctx - the plugin context (must inject `tools`, `fs`, `subprocess`).
 * @param config - the resolved plugin configuration.
 */
export async function apply(ctx: Context, config: ConfigType): Promise<void> {
  // The schema normally fills every editor default; tolerate a raw config handed straight to
  // apply() (tests, programmatic mounting) by defaulting the whole editor group here.
  const resolved = {
    ...(config as ResolvedConfig),
    editor: {
      enabled: false,
      requestTimeoutMs: 60_000,
      diagnosticsCacheMaxFiles: 64,
      ...(config.editor as Partial<ResolvedConfig['editor']> | undefined),
    },
  }
  assertPositiveInteger('maxDiagnostics', resolved.maxDiagnostics)
  assertPositiveInteger('maxCompletionItems', resolved.maxCompletionItems)
  assertPositiveInteger('maxCodeActions', resolved.maxCodeActions)
  assertPositiveInteger('maxSymbols', resolved.maxSymbols)
  assertPositiveInteger('maxSignatures', resolved.maxSignatures)
  assertPositiveInteger('maxInlayHints', resolved.maxInlayHints)
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertPositiveInteger('maxDocumentBytes', resolved.maxDocumentBytes)
  assertTimer('timeoutMs', resolved.timeoutMs)
  assertPositiveInteger('editor.diagnosticsCacheMaxFiles', resolved.editor.diagnosticsCacheMaxFiles)
  assertTimer('editor.requestTimeoutMs', resolved.editor.requestTimeoutMs)

  // Resolve every executable BEFORE registering anything: a bad later command must not publish an
  // earlier tool, matching the official lsp-stdio load contract.
  const servers = await resolveServers(ctx, resolved.servers as Record<string, ResolvedServerEntry>)
  const sandbox = new FormatSandboxController(ctx)
  const client = new LspActionClient(ctx.subprocess, ctx.fs, resolved.maxDocumentBytes)
  // `ctx.lsp` is an optional capability: typed required by the seam package, absent at runtime in
  // compositions without a provider. Consume it structurally and lazily, never by import or by an
  // apply-time snapshot — the seam may load after this plugin or be re-added mid-session.
  const getSeam = (): SeamService | undefined => ctx.get('lsp') as unknown as SeamService | undefined
  const runner = createActionRunner({ getSeam, client, servers })

  ctx.effect(() => {
    registerDiagnosticsTool(ctx, runner, resolved)
    registerCompletionTool(ctx, runner, resolved)
    registerFormatTool(ctx, runner, sandbox, resolved)
    registerCodeActionTool(ctx, runner, resolved)
    registerSymbolsTool(ctx, runner, resolved)
    registerSignatureTool(ctx, runner, resolved)
    registerInlayHintsTool(ctx, runner, resolved)
    registerRenameTool(ctx, runner, sandbox, resolved)
    // The IDE integration backend: `lsp.actions.list` / `lsp.actions.run` / `lsp.events` over
    // JSON-RPC stdio. Only composed when the deployment opts in (editor.enabled) — a Web or CLI
    // composition must never claim stdout. Every registration here is effect-scoped, so stopping
    // or updating the plugin tears down the transport, the listeners, and the cache.
    const editor = resolved.editor.enabled
      ? startEditorProtocol(ctx, runner, sandbox, resolved)
      : undefined
    return async () => {
      await editor?.dispose()
      await client.disposeAll()
    }
  }, 'lsp-actions.registerTools')
}
