/**
 * Pure formatting and presentation for the three LSP action tools: severity-labeled diagnostic
 * text, completion listings marked as reference-only, bounded result truncation, and the pure
 * UI card presenters. No I/O — a UI may call the presenters on live streaming and on replay, so
 * they depend only on tool arguments (and persisted result metadata).
 * @module dsh-lsp-actions/render
 */

import type { GenericCallView, GenericResultView, DiffResultView, ToolResult } from '@deepseek-ai/dsh-tools'

/** Severity labels, indexed by LSP DiagnosticSeverity (1..4). */
const SEVERITY_LABELS = ['', 'Error', 'Warning', 'Information', 'Hint'] as const

/** Projected metadata shapes persisted with the session log (pure projections of canonical values). */
export interface DiagnosticsCardMeta {
  readonly diagnostics: readonly {
    readonly line: number
    readonly severity: number
    readonly message: string
    readonly source?: string
    readonly code?: string | number
  }[]
}

export interface CompletionCardMeta {
  readonly items: readonly { readonly label: string; readonly detail?: string }[]
}

export interface FormatCardMeta {
  readonly diffs: readonly { readonly path: string; readonly oldText: string | null; readonly newText: string }[]
}

/**
 * Format a diagnostics result as model-facing text: one `path:line:character  [Severity] message`
 * line per diagnostic, an omission marker past `maxDiagnostics`, then the complete result cap.
 * @param filePath - the diagnosed file (all diagnostics belong to it).
 * @param diagnostics - the already count-capped diagnostics (the canonical schema's projection).
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text; a distinct no-result line when there are none.
 */
export function formatDiagnostics(
  filePath: string,
  diagnostics: readonly {
    severity: number
    range: { start: { line: number; character: number } }
    message: string
    source?: string
    code?: string | number
  }[],
  maxResultChars: number,
): string {
  if (diagnostics.length === 0) return boundResult(`No diagnostics reported for ${filePath}.`, maxResultChars, 'diagnostics')
  const lines = diagnostics.map((diagnostic) => {
    const line = diagnostic.range.start.line + 1
    const character = diagnostic.range.start.character + 1
    const label = SEVERITY_LABELS[diagnostic.severity] ?? `Severity ${diagnostic.severity}`
    const tail = diagnostic.code === undefined
      ? diagnostic.source === undefined ? '' : ` [${diagnostic.source}]`
      : ` [${diagnostic.source ?? 'server'} ${String(diagnostic.code)}]`
    return `${filePath}:${line}:${character}  [${label}] ${diagnostic.message}${tail}`
  })
  return boundResult(lines.join('\n'), maxResultChars, 'diagnostics')
}

/**
 * Format a completion result as model-facing text. The header marks the items as reference-only:
 * nothing was executed, and applying one is the model's own write/edit decision.
 * @param filePath - the completed file.
 * @param line - the one-based cursor line.
 * @param character - the one-based cursor character.
 * @param items - the already count-capped items (the canonical schema's projection).
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text; a distinct no-result line when there are none.
 */
export function formatCompletionList(
  filePath: string,
  line: number,
  character: number,
  items: readonly { label: string; detail?: string }[],
  maxResultChars: number,
): string {
  const header = `Completion suggestions for ${filePath}:${line}:${character} (reference only — nothing was executed; apply one yourself with write/edit).`
  if (items.length === 0) return boundResult(`${header}\nNo completions available.`, maxResultChars, 'completion')
  const lines = [header, ...items.map((item, index) => {
    const label = item.detail === undefined ? item.label : `${item.label} — ${item.detail}`
    return `${index + 1}. ${label}`
  })]
  return boundResult(lines.join('\n'), maxResultChars, 'completion')
}

/**
 * Format a formatting outcome as one model-facing line; the UI diff card carries the applied
 * change, so the text stays a summary and the model re-reads the file for the full result.
 * @param filePath - the formatted file.
 * @param appliedEdits - how many edits were applied.
 * @returns the summary text.
 */
export function formatAppliedEdits(filePath: string, appliedEdits: number): string {
  return `Formatted ${filePath}: applied ${appliedEdits} edit${appliedEdits === 1 ? '' : 's'}. The result card shows the diff; re-read the file for the full result.`
}

/** Bound a complete rendered result, including the truncation notice itself. */
function boundResult(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  const notice = `\n… ${label} truncated (limit ${maxChars} characters).`
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/** The raw, schema-typed argument shapes the presenters soft-validate against. */
export interface DiagnosticsToolArgs {
  readonly file_path: string
}

export interface CompletionToolArgs {
  readonly file_path: string
  readonly line: number
  readonly character: number
}

export interface FormatToolArgs {
  readonly file_path: string
}

/**
 * Pending-state presenter for `lsp_diagnostics`: a generic search card focused on the file.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspDiagnosticsCall(args: DiagnosticsToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `LSP diagnostics ${args.file_path}`,
    locations: [{ path: args.file_path }],
  }
}

/**
 * Completed-state presenter for `lsp_diagnostics`: severity-labeled lines rebuilt from the
 * persisted projection, with a follow-along location on the first diagnostic.
 * @param _args - the raw tool arguments (unused; the projection carries the result facts).
 * @param result - the completed tool result.
 * @returns the generic result view, or undefined to keep the fallback card.
 */
export function presentLspDiagnosticsResult(_args: DiagnosticsToolArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta as Partial<DiagnosticsCardMeta> | undefined
  if (meta === undefined || !Array.isArray(meta.diagnostics)) return undefined
  if (meta.diagnostics.length === 0) {
    return { card: 'generic', title: `0 diagnostics in ${_args.file_path}`, content: [{ type: 'text', text: 'No diagnostics reported.' }] }
  }
  const lines = meta.diagnostics.map((diagnostic) => {
    const label = SEVERITY_LABELS[diagnostic.severity] ?? `Severity ${diagnostic.severity}`
    const tail = diagnostic.code === undefined
      ? diagnostic.source === undefined ? '' : ` [${diagnostic.source}]`
      : ` [${diagnostic.source ?? 'server'} ${String(diagnostic.code)}]`
    return `${_args.file_path}:${diagnostic.line}  [${label}] ${diagnostic.message}${tail}`
  })
  return {
    card: 'generic',
    title: `${meta.diagnostics.length} diagnostic${meta.diagnostics.length === 1 ? '' : 's'} in ${_args.file_path}`,
    content: [{ type: 'text', text: lines.join('\n') }],
  }
}

/**
 * Pending-state presenter for `lsp_completion`: a generic search card at the cursor.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspCompletionCall(args: CompletionToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `LSP completion ${args.file_path}:${args.line}:${args.character}`,
    locations: [{ path: args.file_path, line: args.line }],
  }
}

/**
 * Completed-state presenter for `lsp_completion`: the reference-only item list rebuilt from the
 * persisted projection.
 * @param args - the raw tool arguments (used for the title).
 * @param result - the completed tool result.
 * @returns the generic result view, or undefined to keep the fallback card.
 */
export function presentLspCompletionResult(args: CompletionToolArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta as Partial<CompletionCardMeta> | undefined
  if (meta === undefined || !Array.isArray(meta.items)) return undefined
  if (meta.items.length === 0) {
    return { card: 'generic', title: `No completions at ${args.file_path}:${args.line}:${args.character}`, content: [{ type: 'text', text: 'No completions available.' }] }
  }
  const lines = meta.items.map((item, index) => {
    return `${index + 1}. ${item.detail === undefined ? item.label : `${item.label} — ${item.detail}`}`
  })
  return {
    card: 'generic',
    title: `${meta.items.length} completion${meta.items.length === 1 ? '' : 's'} at ${args.file_path}:${args.line}:${args.character}`,
    content: [{ type: 'text', text: `Reference only — nothing was executed.\n${lines.join('\n')}` }],
  }
}

/**
 * Pending-state presenter for `lsp_format`: the diff exists only after the server answers, so the
 * pending card is a generic edit card; the completed diff card replaces it.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspFormatCall(args: FormatToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'edit',
    title: `Format ${args.file_path}`,
    locations: [{ path: args.file_path }],
  }
}

/**
 * Completed-state presenter for `lsp_format`: the applied whole-file diff rebuilt from the
 * persisted projection, so replay reproduces the card without re-reading the file.
 * @param args - the raw tool arguments (used for the title).
 * @param result - the completed tool result.
 * @returns the diff result view, or undefined to keep the fallback card.
 */
export function presentLspFormatResult(args: FormatToolArgs, result: ToolResult): DiffResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta as Partial<FormatCardMeta> | undefined
  if (meta === undefined || !Array.isArray(meta.diffs)) return undefined
  if (meta.diffs.length === 0) {
    return { card: 'diff', title: `Format ${args.file_path}`, diffs: [] }
  }
  return { card: 'diff', title: `Format ${args.file_path}`, diffs: [...meta.diffs] }
}
