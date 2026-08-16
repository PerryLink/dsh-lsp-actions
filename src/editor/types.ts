/**
 * Editor action protocol v1 — the wire vocabulary editors consume over ACP-style JSON-RPC. The
 * protocol is intentionally additive and versioned: v1 fields and event kinds are frozen, clients
 * must ignore unknown fields and unknown event kinds, and a breaking change is always published
 * under a new `protocol` version string (never by editing v1). Full spec: `docs/editor-protocol.md`.
 *
 * Positions and ranges on this wire use the LSP convention (zero-based, half-open UTF-16), because
 * editors already speak it; the model-facing tools keep their one-based cursor convention.
 * @module dsh-lsp-actions/editor/types
 */

import type { LspPosition, LspRange } from '../vocabulary.ts'

/** The protocol version string servers advertise in `lsp.actions.list`. */
export const EDITOR_PROTOCOL = 'lsp-actions/v1'

/** The four v1 editor actions. */
export type EditorActionId = 'diagnostics.get' | 'quickfix.apply' | 'format' | 'completion.get'

/** One action descriptor in the `lsp.actions.list` catalog. */
export interface EditorActionDescriptor {
  /** The stable action id passed to `lsp.actions.run`. */
  readonly action: EditorActionId
  /** Whether the action can mutate files; writes go through the official permission presets and approval. */
  readonly writes: boolean
  /** One-line, user-facing description of what the action does. */
  readonly description: string
}

/** One DSH session a connected editor may address (permission/approval binding). */
export interface EditorSessionInfo {
  /** The stable session id to pass as `sessionId` on `lsp.actions.run`. */
  readonly sessionId: string
  /** The session's workspace root (cwd). */
  readonly cwd: string
  /** Whether the session currently has a live agent. */
  readonly live: boolean
}

/** The `lsp.actions.list` result: protocol identity, the action catalog, and the addressable sessions. */
export interface EditorListResult {
  readonly protocol: typeof EDITOR_PROTOCOL
  readonly version: 1
  readonly actions: readonly EditorActionDescriptor[]
  readonly sessions: readonly EditorSessionInfo[]
}

/** One server-visible event payload: a closed kind union the editor renders or routes on. */
export type EditorEvent =
  | {
      readonly kind: 'diagnostics.updated'
      readonly filePath: string
      readonly diagnostics: readonly EditorDiagnostic[]
      readonly truncated: boolean
      readonly total: number
      readonly source?: string
    }
  | {
      readonly kind: 'action.status'
      readonly requestId: string
      readonly action: string
      readonly status: 'started' | 'succeeded' | 'failed'
      readonly error?: EditorErrorInfo
    }
  | {
      readonly kind: 'file.changed'
      readonly filePath: string
    }
  | {
      readonly kind: 'sessions.changed'
      readonly sessions: readonly EditorSessionInfo[]
    }

/** One diagnostic in editor-protocol results and events (zero-based LSP range). */
export interface EditorDiagnostic {
  readonly severity: number
  readonly range: LspRange
  readonly message: string
  readonly source?: string
  readonly code?: string | number
}

/** The stable, machine-routable error shape carried on `run` failure envelopes. */
export interface EditorErrorInfo {
  /** One of the stable `LSP_ACTION_*` / `LSP_PROTOCOL_*` codes; callers route on this, never on text. */
  readonly code: string
  readonly message: string
}

/** The shared `lsp.actions.run` parameter envelope. */
export interface EditorRunRequest {
  /** The action to run. */
  readonly action: string
  /** Action parameters (schema per action, documented in `docs/editor-protocol.md`). */
  readonly params?: Record<string, unknown>
  /** The DSH session the action binds to for permission presets and approval. Optional for read-only actions. */
  readonly sessionId?: string
  /** Client-chosen request identity, echoed on the result and on every `action.status` event. */
  readonly requestId?: string
  /** Protocol version the client speaks; rejected unless the server supports it. */
  readonly protocol?: string
}

/** The unified `lsp.actions.run` result: one envelope for success and structured failure. */
export type EditorRunResult =
  | {
      readonly requestId: string
      readonly action: string
      readonly status: 'succeeded'
      readonly result: unknown
    }
  | {
      readonly requestId: string
      readonly action: string
      readonly status: 'failed'
      readonly error: EditorErrorInfo
    }

/** The four actions' raw parameter shapes (zero-based LSP positions, workspace-rooted paths). */
export interface EditorDiagnosticsParams {
  readonly filePath: string
  readonly workspaceRoot: string
  /** When true, echo the source text the diagnostics were computed against (capped). */
  readonly includeSource?: boolean
}

export interface EditorCompletionParams {
  readonly filePath: string
  readonly workspaceRoot: string
  /** Zero-based cursor position. */
  readonly position: LspPosition
}

export interface EditorFormatParams {
  readonly filePath: string
  readonly workspaceRoot: string
  /** Optional zero-based selection; omit for the whole file. */
  readonly range?: LspRange
  /** Official one-shot escalation pair (only meaningful under a confining sandbox). */
  readonly sandbox_permissions?: string
  readonly justification?: string
}

export interface EditorQuickfixParams {
  readonly filePath: string
  readonly workspaceRoot: string
  /** Optional zero-based range; omit to target the first cached error diagnostic for the file. */
  readonly range?: LspRange
  /** Exact `title` of the code action to apply (wins over `index`). */
  readonly title?: string
  /** Zero-based index into the server's action list (default 0). */
  readonly index?: number
  /** Optional CodeActionKind filters, e.g. `["quickfix"]`. */
  readonly only?: readonly string[]
  /** Official one-shot escalation pair (only meaningful under a confining sandbox). */
  readonly sandbox_permissions?: string
  readonly justification?: string
}

/** The four actions' result payloads (the `result` of a succeeded `run` envelope). */
export type EditorActionResult =
  | {
      readonly kind: 'diagnostics'
      readonly filePath: string
      readonly diagnostics: readonly EditorDiagnostic[]
      readonly truncated: boolean
      readonly total: number
      readonly source?: string
    }
  | {
      readonly kind: 'completion'
      readonly filePath: string
      readonly position: LspPosition
      readonly items: readonly {
        label: string
        kind?: number
        detail?: string
        insertText?: string
        sortText?: string
        textEdit?: { range: LspRange; newText: string }
      }[]
      readonly truncated: boolean
      readonly total: number
    }
  | {
      readonly kind: 'formatted'
      readonly filePath: string
      readonly appliedEdits: number
      readonly linesChanged: number
      readonly before: string
      readonly after: string
    }
  | {
      readonly kind: 'unchanged'
      readonly filePath: string
    }
  | {
      readonly kind: 'quickfixApplied'
      readonly filePath: string
      readonly title: string
      readonly filesChanged: number
      readonly appliedEdits: number
      readonly diffs: readonly { filePath: string; before: string; after: string }[]
    }
