/**
 * The official-seam consumer (path one): run each action through the extended `ctx.lsp` seam when
 * it is mounted and serves the operation, and classify failures so the runner can fall back to
 * the plugin's own client only where that is the right call. The seam vocabulary is consumed
 * structurally, never by import, so the plugin keeps working against every seam vintage.
 * @module dsh-lsp-actions/seam
 */

import type { LspActionOperation, LspActionResult, LspPosition, LspRange } from './vocabulary.ts'

/** The structural surface the extended `ctx.lsp` seam exposes (see the upstream PR proposal). */
export interface SeamService {
  query(
    request: {
      readonly operation: LspActionOperation
      readonly filePath: string
      readonly position?: LspPosition
      readonly range?: LspRange
      readonly workspaceRoot: string
      /** The symbol-name query, for workspace symbol search. */
      readonly query?: string
      /** CodeActionKind filters, for code actions. */
      readonly onlyKinds?: readonly string[]
      /** The new symbol name, for rename. */
      readonly newName?: string
    },
    signal?: AbortSignal,
  ): Promise<LspActionResult>
}

/** Operation-specific extras a seam query may carry (`query`, `onlyKinds`, `newName`). */
export interface SeamExtras {
  readonly query?: string
  readonly onlyKinds?: readonly string[]
  readonly newName?: string
}

/** The classification of one seam attempt, deciding whether the runner falls back or fails. */
export type SeamAttempt =
  | { readonly ok: true; readonly result: LspActionResult }
  | { readonly ok: false; readonly reason: 'absent' }
  | { readonly ok: false; readonly reason: 'legacy' }
  | { readonly ok: false; readonly reason: 'unavailable' }
  | { readonly ok: false; readonly reason: 'unsupported' }
  | { readonly ok: false; readonly reason: 'error'; readonly error: unknown }

/**
 * Run one action through the seam and classify the outcome. Success returns the result; the
 * fallback reasons (`absent`, `legacy`, `unavailable`) let the runner serve the call through the
 * plugin's own client, while `unsupported` and `error` fail loud.
 * @param seam - the mounted `ctx.lsp` service, when present.
 * @param operation - the action to run.
 * @param filePath - the source file.
 * @param workspaceRoot - the workspace root.
 * @param position - the cursor position, for completion, signature help, and rename.
 * @param range - the formatting/code-action/inlay-hint range.
 * @param signal - optional cancellation.
 * @param extras - operation-specific extras (`query`, `onlyKinds`, `newName`) the operation carries.
 * @returns the classified attempt.
 */
export async function trySeamAction(
  seam: SeamService | undefined,
  operation: LspActionOperation,
  filePath: string,
  workspaceRoot: string,
  position: LspPosition | undefined,
  range: LspRange | undefined,
  signal: AbortSignal | undefined,
  extras: SeamExtras = {},
): Promise<SeamAttempt> {
  if (seam === undefined) return { ok: false, reason: 'absent' }
  try {
    const result = await seam.query({
      operation,
      filePath,
      workspaceRoot,
      ...position === undefined ? {} : { position },
      ...range === undefined ? {} : { range },
      ...extras.query === undefined ? {} : { query: extras.query },
      ...extras.onlyKinds === undefined ? {} : { onlyKinds: extras.onlyKinds },
      ...extras.newName === undefined ? {} : { newName: extras.newName },
    }, signal)
    return { ok: true, result }
  } catch (error) {
    // An abort is the caller's own cancellation (timeout policy), not a seam capability fact:
    // surface the signal's reason, never the seam's unrelated error or a fallback classification.
    if (signal?.aborted) throw signal.reason
    const code = errorCodeOf(error)
    if (code === 'LSP_UNAVAILABLE') return { ok: false, reason: 'unavailable' }
    if (code === 'LSP_UNSUPPORTED_OPERATION') return { ok: false, reason: 'unsupported' }
    // A code-less failure is the pre-action seam (or its provider) rejecting an unknown operation:
    // it can never serve actions, so the runner falls back to the plugin's own client.
    if (code === undefined) return { ok: false, reason: 'legacy' }
    return { ok: false, reason: 'error', error }
  }
}

/** Extract a stable error code from an unknown thrown value, without instanceof across copies. */
function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}
