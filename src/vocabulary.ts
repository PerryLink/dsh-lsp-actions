/**
 * Action-surface vocabulary: the normalized diagnostics / edits / completion result unions the
 * three tools consume, plus the stable structured error taxonomy. Field-for-field, this mirrors
 * the proposed upstream `ctx.lsp` action vocabulary (see `docs/seam-extension-notes.md`), so the
 * plugin migrates to the official seam by swapping the runner, not the tool contracts.
 * @module dsh-lsp-actions/vocabulary
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * The LSP actions this plugin exposes: the three core actions plus the extended surface (code
 * actions, symbols, signatures, inlay hints) and the writing `rename` action. Navigation stays
 * with the official `lsp` tool. `rename` is a plugin-local extension beyond the proposed upstream
 * seam union; a seam that cannot serve it falls back to the built-in client.
 */
export type LspActionOperation =
  | 'diagnostics'
  | 'formatDocument'
  | 'completion'
  | 'codeAction'
  | 'workspaceSymbol'
  | 'documentSymbol'
  | 'signatureHelp'
  | 'inlayHint'
  | 'rename'

/** A zero-based UTF-16 cursor coordinate, matching the LSP wire convention. */
export interface LspPosition {
  /** Zero-based line. */
  readonly line: number
  /** Zero-based UTF-16 code-unit offset within the line. */
  readonly character: number
}

/** A zero-based UTF-16 half-open range `[start, end)`. */
export interface LspRange {
  readonly start: LspPosition
  readonly end: LspPosition
}

/** LSP DiagnosticSeverity: Error, Warning, Information, Hint. */
export type LspDiagnosticSeverity = 1 | 2 | 3 | 4

/** One normalized diagnostic from the server. */
export interface LspDiagnostic {
  /** Severity 1 (error) through 4 (hint); LSP defaults an omitted severity to 1. */
  readonly severity: LspDiagnosticSeverity
  /** The range the diagnostic applies to. */
  readonly range: LspRange
  /** The human-readable diagnostic message. */
  readonly message: string
  /** The reporting tool, when the server names one (e.g. `typescript`). */
  readonly source?: string
  /** The stable machine-readable diagnostic code, string or numeric. */
  readonly code?: string | number
}

/** One normalized text edit the server proposed. */
export interface LspTextEdit {
  /** The range the edit replaces. */
  readonly range: LspRange
  /** The replacement text (may be empty, for a deletion). */
  readonly newText: string
}

/** One normalized completion item. */
export interface LspCompletionItem {
  /** The completion label. */
  readonly label: string
  /** CompletionItemKind, when the server sent one. */
  readonly kind?: number
  /** A human-readable detail line, when present. */
  readonly detail?: string
  /** Plain insertion text, when the server sent it instead of a text edit. */
  readonly insertText?: string
  /** The range-replacing edit form, when the server sent one. */
  readonly textEdit?: LspTextEdit
  /** Sorting key, when the server sent one. */
  readonly sortText?: string
}

/** One normalized code action: server-verified edits per document, or a server command (never run). */
export interface LspCodeActionItem {
  /** The action's short title. */
  readonly title: string
  /** CodeActionKind, when the server sent one (e.g. `quickfix`). */
  readonly kind?: string
  /** The server's preferred-action marker, when sent. */
  readonly isPreferred?: boolean
  /** Edits grouped by target document URI; applying them is the model's own write/edit decision. */
  readonly edits: Readonly<Record<string, readonly LspTextEdit[]>>
  /** A server command form; the plugin never executes commands, only reports them. */
  readonly command?: { readonly title: string; readonly command: string; readonly arguments?: unknown }
}

/** One normalized symbol (workspace or document scope). */
export interface LspSymbol {
  /** The symbol name. */
  readonly name: string
  /** SymbolKind. */
  readonly kind: number
  /** The symbol's location (document URI plus range). */
  readonly location: { readonly uri: string; readonly range: LspRange }
  /** The enclosing container, when the server named one. */
  readonly containerName?: string
}

/** One normalized signature (signature help). */
export interface LspSignature {
  /** The signature's rendered label. */
  readonly label: string
  /** Human-readable documentation, when present. */
  readonly documentation?: string
  /** Per-parameter labels and documentation, when the server sent them. */
  readonly parameters?: readonly { readonly label: string; readonly documentation?: string }[]
}

/** One normalized inlay hint (type annotations and similar server hints). */
export interface LspInlayHint {
  /** The position the hint annotates. */
  readonly position: LspPosition
  /** The rendered label. */
  readonly label: string
  /** InlayHintKind, when sent (1 = type, 2 = parameter). */
  readonly kind?: number
  /** Padding markers, verbatim from the server. */
  readonly paddingLeft?: boolean
  readonly paddingRight?: boolean
}

/** The closed result unions: one kind per action, matching the proposed seam vocabulary. */
export type LspDiagnosticsResult = { readonly kind: 'diagnostics'; readonly diagnostics: readonly LspDiagnostic[] }
export type LspEditsResult = { readonly kind: 'edits'; readonly edits: readonly LspTextEdit[] }
export type LspCompletionResult = { readonly kind: 'completion'; readonly items: readonly LspCompletionItem[] }
export type LspCodeActionsResult = { readonly kind: 'codeActions'; readonly items: readonly LspCodeActionItem[] }
export type LspSymbolsResult = { readonly kind: 'symbols'; readonly items: readonly LspSymbol[] }
export type LspSignaturesResult = {
  readonly kind: 'signatures'
  readonly signatures: readonly LspSignature[]
  readonly activeSignature?: number
  readonly activeParameter?: number
}
export type LspInlayHintsResult = { readonly kind: 'inlayHints'; readonly items: readonly LspInlayHint[] }
/** The rename result: server-verified text edits grouped by target document URI (utf-16 positions). */
export type LspRenameResult = { readonly kind: 'rename'; readonly edits: Readonly<Record<string, readonly LspTextEdit[]>> }
export type LspActionResult =
  | LspDiagnosticsResult
  | LspEditsResult
  | LspCompletionResult
  | LspCodeActionsResult
  | LspSymbolsResult
  | LspSignaturesResult
  | LspInlayHintsResult
  | LspRenameResult

/** Stable machine-routable codes for LSP action failures, carried on {@link LspActionError}. */
export type LspActionErrorCode =
  | 'LSP_ACTION_UNAVAILABLE'
  | 'LSP_ACTION_UNSUPPORTED'
  | 'LSP_ACTION_SERVER_FAILED'
  | 'LSP_ACTION_MALFORMED_RESPONSE'
  | 'LSP_ACTION_CONFLICT'
  | 'LSP_ACTION_READ_ONLY'
  | 'LSP_ACTION_WORKSPACE_REQUIRED'
  | 'LSP_ACTION_NO_SYMBOL'

/**
 * Structured LSP action failure. Extends {@link HarnessError} so the tool registry surfaces
 * `{ name, code }` on error results; callers route on `code`, never on `message` text.
 */
export class LspActionError extends HarnessError {
  override readonly code: LspActionErrorCode

  constructor(message: string, code: LspActionErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
