/**
 * The action runner the three tools call: official-seam-first, own-client-fallback. When the
 * extended `ctx.lsp` seam is mounted, actions go through it; when the seam is absent, too old, or
 * has no provider for the file, the plugin's own client serves the call from the `servers` table.
 * A seam provider that exists but lacks the capability fails loud — the user configured the
 * server in one place and gets a real error instead of a silently spawned duplicate.
 * @module dsh-lsp-actions/runner
 */

import { LspActionClient } from './client.ts'
import type { ActionRequest } from './client.ts'
import type { HostSource } from './host.ts'
import { finalExtension } from './extension.ts'
import { routeFile } from './servers.ts'
import type { ResolvedServer } from './servers.ts'
import { trySeamAction } from './seam.ts'
import type { SeamService } from './seam.ts'
import type {
  LspActionResult,
  LspCodeActionsResult,
  LspCompletionResult,
  LspDiagnosticsResult,
  LspEditsResult,
  LspInlayHintsResult,
  LspPosition,
  LspRange,
  LspSignaturesResult,
  LspSymbolsResult,
} from './vocabulary.ts'
import { LspActionError } from './vocabulary.ts'

/** One action call as the tools prepare it: everything the runner needs to serve it either way. */
export interface RunnerRequest {
  /** The source file (relative to `workspaceRoot` or absolute). */
  readonly filePath: string
  /** The workspace root the server resolves against. */
  readonly workspaceRoot: string
  /** The pre-read source the own client's didOpen synchronizes (the seam re-reads its own copy). */
  readonly source?: HostSource
  /** The cursor position, for completion and signature help. */
  readonly position?: LspPosition
  /** The formatting/code-action/inlay-hint range, for range-scoped operations. */
  readonly range?: LspRange
  /** The symbol name query, for workspace symbol search. */
  readonly query?: string
  /** CodeActionKind filters, for code actions. */
  readonly onlyKinds?: readonly string[]
}

/** The unified surface the tools consume, agnostic of which backend served the result. */
export interface ActionRunner {
  diagnostics(request: RunnerRequest, signal?: AbortSignal): Promise<LspDiagnosticsResult>
  formatDocument(request: RunnerRequest, signal?: AbortSignal): Promise<LspEditsResult>
  completion(request: RunnerRequest, signal?: AbortSignal): Promise<LspCompletionResult>
  codeActions(request: RunnerRequest, signal?: AbortSignal): Promise<LspCodeActionsResult>
  workspaceSymbols(request: RunnerRequest, signal?: AbortSignal): Promise<LspSymbolsResult>
  documentSymbols(request: RunnerRequest, signal?: AbortSignal): Promise<LspSymbolsResult>
  signatureHelp(request: RunnerRequest, signal?: AbortSignal): Promise<LspSignaturesResult>
  inlayHints(request: RunnerRequest, signal?: AbortSignal): Promise<LspInlayHintsResult>
}

/**
 * Create the seam-first action runner. The seam is resolved through `getSeam` on every call, not
 * captured at apply time, so the plugin serves through a seam that loads after it or is re-added
 * later; a seam that is absent at call time falls back to the own client.
 * @param options - the per-call seam resolver, the own client, and the resolved server table.
 * @returns the runner facade.
 */
export function createActionRunner(options: {
  readonly getSeam: () => SeamService | undefined
  readonly client: LspActionClient
  readonly servers: readonly ResolvedServer[]
}): ActionRunner {
  return {
    diagnostics: (request, signal) => runOp({ ...options, seam: options.getSeam() }, 'diagnostics', request, signal),
    formatDocument: (request, signal) => runOp({ ...options, seam: options.getSeam() }, 'formatDocument', request, signal),
    completion: (request, signal) => runOp({ ...options, seam: options.getSeam() }, 'completion', request, signal),
    codeActions: (request, signal) => runOp({ ...options, seam: options.getSeam() }, 'codeAction', request, signal),
    workspaceSymbols: (request, signal) => runOp({ ...options, seam: options.getSeam() }, 'workspaceSymbol', request, signal),
    documentSymbols: (request, signal) => runOp({ ...options, seam: options.getSeam() }, 'documentSymbol', request, signal),
    signatureHelp: (request, signal) => runOp({ ...options, seam: options.getSeam() }, 'signatureHelp', request, signal),
    inlayHints: (request, signal) => runOp({ ...options, seam: options.getSeam() }, 'inlayHint', request, signal),
  }
}

/** Serve one action: seam first, then the own client, failing loud where fallback is wrong. */
async function runOp(
  options: {
    readonly seam: SeamService | undefined
    readonly client: LspActionClient
    readonly servers: readonly ResolvedServer[]
  },
  operation: 'diagnostics',
  request: RunnerRequest,
  signal?: AbortSignal,
): Promise<LspDiagnosticsResult>
async function runOp(
  options: {
    readonly seam: SeamService | undefined
    readonly client: LspActionClient
    readonly servers: readonly ResolvedServer[]
  },
  operation: 'formatDocument',
  request: RunnerRequest,
  signal?: AbortSignal,
): Promise<LspEditsResult>
async function runOp(
  options: {
    readonly seam: SeamService | undefined
    readonly client: LspActionClient
    readonly servers: readonly ResolvedServer[]
  },
  operation: 'completion',
  request: RunnerRequest,
  signal?: AbortSignal,
): Promise<LspCompletionResult>
async function runOp(
  options: {
    readonly seam: SeamService | undefined
    readonly client: LspActionClient
    readonly servers: readonly ResolvedServer[]
  },
  operation: 'codeAction',
  request: RunnerRequest,
  signal?: AbortSignal,
): Promise<LspCodeActionsResult>
async function runOp(
  options: {
    readonly seam: SeamService | undefined
    readonly client: LspActionClient
    readonly servers: readonly ResolvedServer[]
  },
  operation: 'workspaceSymbol' | 'documentSymbol',
  request: RunnerRequest,
  signal?: AbortSignal,
): Promise<LspSymbolsResult>
async function runOp(
  options: {
    readonly seam: SeamService | undefined
    readonly client: LspActionClient
    readonly servers: readonly ResolvedServer[]
  },
  operation: 'signatureHelp',
  request: RunnerRequest,
  signal?: AbortSignal,
): Promise<LspSignaturesResult>
async function runOp(
  options: {
    readonly seam: SeamService | undefined
    readonly client: LspActionClient
    readonly servers: readonly ResolvedServer[]
  },
  operation: 'inlayHint',
  request: RunnerRequest,
  signal?: AbortSignal,
): Promise<LspInlayHintsResult>
async function runOp(
  options: {
    readonly seam: SeamService | undefined
    readonly client: LspActionClient
    readonly servers: readonly ResolvedServer[]
  },
  operation: 'diagnostics' | 'formatDocument' | 'completion' | 'codeAction' | 'workspaceSymbol' | 'documentSymbol' | 'signatureHelp' | 'inlayHint',
  request: RunnerRequest,
  signal?: AbortSignal,
): Promise<LspActionResult> {
  if (options.seam !== undefined) {
    const attempt = await trySeamAction(
      options.seam,
      operation,
      request.filePath,
      request.workspaceRoot,
      request.position,
      request.range,
      signal,
    )
    if (attempt.ok) return attempt.result
    if (attempt.reason === 'unsupported') {
      throw new LspActionError(
        `the mounted ctx.lsp provider does not support ${operation}; configure a server that advertises it`,
        'LSP_ACTION_UNSUPPORTED',
      )
    }
    if (attempt.reason === 'error') throw attempt.error
    // absent / legacy / unavailable: the seam cannot serve this action — fall through to the
    // plugin's own client, which fails loud itself when no server entry handles the file.
  }
  // Workspace symbol search has no document to route by: when no entry matches (or no file path
  // was supplied), fall back to the first configured server.
  const route = routeFile(options.servers, request.filePath) ?? firstServerRoute(options.servers, operation)
  if (route === undefined) {
    throw new LspActionError(noRouteMessage(request.filePath), 'LSP_ACTION_UNAVAILABLE')
  }
  if (operation === 'workspaceSymbol') {
    // With a routing file, keep it open for the request: project-based servers (tsls) refuse
    // document-free workspace/symbol.
    if (request.source !== undefined) {
      const actionRequest: ActionRequest = {
        filePath: request.filePath,
        workspaceRoot: request.workspaceRoot,
        source: request.source,
        languageId: route.languageId,
      }
      return await options.client.workspaceSymbolsInDocument(route.server, actionRequest, request.query ?? '', signal)
    }
    return await options.client.workspaceSymbols(route.server, request.workspaceRoot, request.query ?? '', signal)
  }
  if (request.source === undefined) {
    throw new LspActionError(`the ${operation} action requires a source document`, 'LSP_ACTION_WORKSPACE_REQUIRED')
  }
  const actionRequest: ActionRequest = {
    filePath: request.filePath,
    workspaceRoot: request.workspaceRoot,
    source: request.source,
    languageId: route.languageId,
    ...request.position === undefined ? {} : { position: request.position },
    ...request.range === undefined ? {} : { range: request.range },
    ...request.onlyKinds === undefined ? {} : { onlyKinds: request.onlyKinds },
  }
  switch (operation) {
    case 'diagnostics': return await options.client.diagnostics(route.server, actionRequest, signal)
    case 'formatDocument': return await options.client.formatDocument(route.server, actionRequest, signal)
    case 'completion': return await options.client.completion(route.server, actionRequest, signal)
    case 'codeAction': return await options.client.codeActions(route.server, actionRequest, signal)
    case 'documentSymbol': return await options.client.documentSymbols(route.server, actionRequest, signal)
    case 'signatureHelp': return await options.client.signatureHelp(route.server, actionRequest, signal)
    case 'inlayHint': return await options.client.inlayHints(route.server, actionRequest, signal)
  }
}

/** The first configured server's route, for workspace-scoped actions without a file to route by. */
function firstServerRoute(servers: readonly ResolvedServer[], operation: string): { server: ResolvedServer; languageId: string } | undefined {
  if (operation !== 'workspaceSymbol') return undefined
  const first = servers[0]
  if (first === undefined) return undefined
  return { server: first, languageId: firstLanguageId(first) }
}

/** The first extension mapping's language id, used when no file route applies. */
function firstLanguageId(server: ResolvedServer): string {
  const languageId = Object.values(server.entry.extensionToLanguage)[0]
  if (languageId === undefined) throw new Error(`lsp-actions: server "${server.serverId}" maps no extensions`)
  return languageId
}

/** The fail-loud message when neither the seam nor the servers table handles the file. */
function noRouteMessage(filePath: string): string {
  const extension = finalExtension(filePath)
  const subject = extension === '' ? 'this file type' : `files with the "${extension}" extension`
  return `no LSP server is configured for ${subject} — add an entry to the lsp-actions servers table, or register an LSP provider on ctx.lsp`
}
