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
  LspCompletionResult,
  LspDiagnosticsResult,
  LspEditsResult,
  LspPosition,
  LspRange,
} from './vocabulary.ts'
import { LspActionError } from './vocabulary.ts'

/** One action call as the tools prepare it: everything the runner needs to serve it either way. */
export interface RunnerRequest {
  /** The source file (relative to `workspaceRoot` or absolute). */
  readonly filePath: string
  /** The workspace root the server resolves against. */
  readonly workspaceRoot: string
  /** The pre-read source the own client's didOpen synchronizes (the seam re-reads its own copy). */
  readonly source: HostSource
  /** The cursor position, for completion. */
  readonly position?: LspPosition
  /** The formatting range, for range formatting. */
  readonly range?: LspRange
}

/** The unified surface the three tools consume, agnostic of which backend served the result. */
export interface ActionRunner {
  diagnostics(request: RunnerRequest, signal?: AbortSignal): Promise<LspDiagnosticsResult>
  formatDocument(request: RunnerRequest, signal?: AbortSignal): Promise<LspEditsResult>
  completion(request: RunnerRequest, signal?: AbortSignal): Promise<LspCompletionResult>
}

/**
 * Create the seam-first action runner.
 * @param options - the mounted seam (when present), the own client, and the resolved server table.
 * @returns the runner facade.
 */
export function createActionRunner(options: {
  readonly seam: SeamService | undefined
  readonly client: LspActionClient
  readonly servers: readonly ResolvedServer[]
}): ActionRunner {
  return {
    diagnostics: (request, signal) => runOp(options, 'diagnostics', request, signal),
    formatDocument: (request, signal) => runOp(options, 'formatDocument', request, signal),
    completion: (request, signal) => runOp(options, 'completion', request, signal),
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
  operation: 'diagnostics' | 'formatDocument' | 'completion',
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
  const route = routeFile(options.servers, request.filePath)
  if (route === undefined) {
    throw new LspActionError(noRouteMessage(request.filePath), 'LSP_ACTION_UNAVAILABLE')
  }
  const actionRequest: ActionRequest = {
    filePath: request.filePath,
    workspaceRoot: request.workspaceRoot,
    source: request.source,
    languageId: route.languageId,
    ...request.position === undefined ? {} : { position: request.position },
    ...request.range === undefined ? {} : { range: request.range },
  }
  switch (operation) {
    case 'diagnostics': return await options.client.diagnostics(route.server, actionRequest, signal)
    case 'formatDocument': return await options.client.formatDocument(route.server, actionRequest, signal)
    case 'completion': return await options.client.completion(route.server, actionRequest, signal)
  }
}

/** The fail-loud message when neither the seam nor the servers table handles the file. */
function noRouteMessage(filePath: string): string {
  const extension = finalExtension(filePath)
  const subject = extension === '' ? 'this file type' : `files with the "${extension}" extension`
  return `no LSP server is configured for ${subject} — add an entry to the lsp-actions servers table, or register an LSP provider on ctx.lsp`
}
