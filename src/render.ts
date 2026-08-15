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

/** LSP SymbolKind labels, indexed 1..26 (CompletionItemKind shares the same numbering). */
const SYMBOL_KIND_LABELS = [
  '', 'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field', 'Constructor',
  'Enum', 'Interface', 'Function', 'Variable', 'Constant', 'String', 'Number', 'Boolean', 'Array',
  'Object', 'Key', 'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter',
] as const

/** The human-readable label for a numeric LSP symbol/completion kind. */
export function symbolKindLabel(kind: number): string {
  const label = SYMBOL_KIND_LABELS[kind]
  return label === undefined || label === '' ? `Kind ${kind}` : label
}

/** Projected metadata shapes persisted with the session log (pure projections of canonical values). */
export interface DiagnosticsCardMeta {
  readonly diagnostics: readonly {
    readonly line: number
    readonly character?: number
    readonly severity: number
    readonly message: string
    readonly source?: string
    readonly code?: string | number
  }[]
}

export interface CompletionCardMeta {
  readonly items: readonly { readonly label: string; readonly detail?: string; readonly insertText?: string }[]
}

export interface FormatCardMeta {
  readonly diffs: readonly { readonly path: string; readonly oldText: string | null; readonly newText: string }[]
}

export interface CodeActionCardMeta {
  readonly items: readonly { readonly title: string; readonly kind?: string; readonly isPreferred?: boolean }[]
}

export interface SymbolsCardMeta {
  readonly items: readonly { readonly name: string; readonly kind: number; readonly location: { readonly uri: string; readonly line: number; readonly character: number } }[]
}

export interface SignaturesCardMeta {
  readonly signatures: readonly { readonly label: string; readonly documentation?: string }[]
}

export interface InlayHintsCardMeta {
  readonly items: readonly { readonly line: number; readonly character: number; readonly label: string }[]
}

export interface RenameCardMeta {
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
 * nothing was executed, and applying one is the model's own write/edit decision. Each item shows
 * its label and detail, plus the actual insertion text (textEdit.newText, else insertText, else
 * the label) on an indented `→` line when it adds information — the label alone is often not what
 * the server would insert.
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
  items: readonly { label: string; detail?: string; insertText?: string; textEdit?: { newText: string } }[],
  maxResultChars: number,
): string {
  const header = `Completion suggestions for ${filePath}:${line}:${character} (reference only — nothing was executed; apply one yourself with write/edit).`
  if (items.length === 0) return boundResult(`${header}\nNo completions available.`, maxResultChars, 'completion')
  const lines = [header, ...items.flatMap((item, index) => {
    const label = item.detail === undefined ? item.label : `${item.label} — ${item.detail}`
    const insertText = completionInsertText(item)
    const snippet = insertText === undefined || insertText === item.label ? [] : [`   → ${insertText}`]
    return [`${index + 1}. ${label}`, ...snippet]
  })]
  return boundResult(lines.join('\n'), maxResultChars, 'completion')
}

/** The text this item would insert: textEdit.newText wins, then insertText, then nothing. */
function completionInsertText(item: { insertText?: string; textEdit?: { newText: string } }): string | undefined {
  return item.textEdit?.newText ?? item.insertText
}

/**
 * Format a formatting outcome as one model-facing line; the UI diff card carries the applied
 * change, so the text stays a summary and the model re-reads the file for the full result. The
 * optional one-based line span names how much of the file changed, so the model can decide whether
 * a re-read is worth the tokens.
 * @param filePath - the formatted file.
 * @param appliedEdits - how many edits were applied.
 * @param linesChanged - the one-based line span the edits touch; omitted keeps the bare summary.
 * @returns the summary text.
 */
export function formatAppliedEdits(filePath: string, appliedEdits: number, linesChanged?: number): string {
  const span = linesChanged === undefined ? '' : ` across ${linesChanged} line${linesChanged === 1 ? '' : 's'}`
  return `Formatted ${filePath}: applied ${appliedEdits} edit${appliedEdits === 1 ? '' : 's'}${span}. The result card shows the diff; re-read the file for the full result.`
}

/** Bound a complete rendered result, including the truncation notice itself. */
function boundResult(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  const notice = `\n… ${label} truncated (limit ${maxChars} characters).`
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/**
 * Format a code action result as model-facing text: one numbered line per action, then each
 * action's edits with the replacement text. Reference-only — nothing is applied, and a command
 * form is reported but never executed.
 * @param filePath - the file actions were requested for.
 * @param items - the normalized actions (edits in the uri→list projection).
 * @param maxResultChars - the complete rendered-text cap.
 * @returns the rendered text.
 */
export function formatCodeActions(
  filePath: string,
  items: readonly {
    title: string
    kind?: string
    isPreferred?: boolean
    edits?: readonly { uri: string; edits: readonly { range: { start: { line: number; character: number } }; newText: string }[] }[]
    command?: { readonly title: string; readonly command: string }
  }[],
  maxResultChars: number,
): string {
  const header = `Code actions for ${filePath} (reference only — nothing was applied; apply an action's edits yourself with write/edit).`
  if (items.length === 0) return boundResult(`${header}\nNo code actions available.`, maxResultChars, 'code actions')
  const lines = [header]
  for (const [index, item] of items.entries()) {
    const tags = [
      item.kind === undefined ? '' : item.kind,
      item.isPreferred === true ? 'preferred' : '',
    ].filter(tag => tag !== '').join(', ')
    lines.push(`${index + 1}. ${item.title}${tags === '' ? '' : ` [${tags}]`}`)
    for (const document of item.edits ?? []) {
      for (const edit of document.edits) {
        const at = `${document.uri}:${edit.range.start.line + 1}:${edit.range.start.character + 1}`
        lines.push(`     ${at} → ${singleLine(edit.newText)}`)
      }
    }
    if (item.command !== undefined) {
      lines.push(`     command (reference only, never executed): ${item.command.title}`)
    }
  }
  return boundResult(lines.join('\n'), maxResultChars, 'code actions')
}

/**
 * Format a symbol result as model-facing text: one `name [Kind] at uri:line:col` line per symbol.
 * @param items - the normalized symbols.
 * @param maxResultChars - the complete rendered-text cap.
 * @returns the rendered text.
 */
export function formatSymbols(
  items: readonly {
    name: string
    kind: number
    location: { uri: string; range: { start: { line: number; character: number } } }
    containerName?: string
  }[],
  maxResultChars: number,
): string {
  const header = `Symbols (${items.length}):`
  if (items.length === 0) return boundResult(`${header} no symbols found.`, maxResultChars, 'symbols')
  const lines = [header, ...items.map((item) => {
    const at = `${item.location.uri}:${item.location.range.start.line + 1}:${item.location.range.start.character + 1}`
    const container = item.containerName === undefined ? '' : ` in ${item.containerName}`
    return `${item.name} [${symbolKindLabel(item.kind)}]${container} at ${at}`
  })]
  return boundResult(lines.join('\n'), maxResultChars, 'symbols')
}

/**
 * Format a signature help result as model-facing text: the signatures with the active one and
 * active parameter marked, plus parameter labels and documentation.
 * @param filePath - the completed file.
 * @param signatures - the normalized signatures.
 * @param activeSignature - the server's active signature index.
 * @param activeParameter - the server's active parameter index.
 * @param maxResultChars - the complete rendered-text cap.
 * @returns the rendered text.
 */
export function formatSignatures(
  filePath: string,
  signatures: readonly { label: string; documentation?: string; parameters?: readonly { label: string; documentation?: string }[] }[],
  activeSignature: number | undefined,
  activeParameter: number | undefined,
  maxResultChars: number,
): string {
  const header = `Signature help for ${filePath}:`
  if (signatures.length === 0) return boundResult(`${header}\nNo signatures available.`, maxResultChars, 'signatures')
  const lines = [header]
  for (const [index, signature] of signatures.entries()) {
    const marker = activeSignature === index ? '▶' : ' '
    lines.push(`${marker} ${index + 1}. ${signature.label}`)
    for (const [parameterIndex, parameter] of (signature.parameters ?? []).entries()) {
      const active = activeSignature === index && activeParameter === parameterIndex ? '  ▶ ' : '     '
      const doc = parameter.documentation === undefined ? '' : ` — ${parameter.documentation}`
      lines.push(`${active}${parameter.label}${doc}`)
    }
    if (signature.documentation !== undefined) lines.push(`     ${signature.documentation}`)
  }
  return boundResult(lines.join('\n'), maxResultChars, 'signatures')
}

/**
 * Format an inlay hint result as model-facing text: one `line:col label` line per hint.
 * @param filePath - the hinted file.
 * @param items - the normalized hints.
 * @param maxResultChars - the complete rendered-text cap.
 * @returns the rendered text.
 */
export function formatInlayHints(
  filePath: string,
  items: readonly { position: { line: number; character: number }; label: string; kind?: number }[],
  maxResultChars: number,
): string {
  const header = `Inlay hints for ${filePath}:`
  if (items.length === 0) return boundResult(`${header}\nNo inlay hints available.`, maxResultChars, 'inlay hints')
  const lines = [header, ...items.map((item) => {
    const kind = item.kind === undefined ? '' : item.kind === 1 ? ' [type]' : item.kind === 2 ? ' [parameter]' : ` [kind ${item.kind}]`
    return `${item.position.line + 1}:${item.position.character + 1}  ${item.label}${kind}`
  })]
  return boundResult(lines.join('\n'), maxResultChars, 'inlay hints')
}

/**
 * Format a rename outcome as one model-facing line; the UI diff cards carry the applied changes
 * per file, so the text stays a summary and the model re-reads the files for the full result.
 * @param filePath - the file the rename was requested in.
 * @param line - the one-based cursor line.
 * @param character - the one-based cursor character.
 * @param newName - the new symbol name.
 * @param appliedEdits - how many edits were applied across the workspace.
 * @param filesChanged - how many files changed.
 * @returns the summary text.
 */
export function formatRenameResult(
  filePath: string,
  line: number,
  character: number,
  newName: string,
  appliedEdits: number,
  filesChanged: number,
): string {
  return `Renamed the symbol at ${filePath}:${line}:${character} to "${newName}": applied ${appliedEdits} edit${appliedEdits === 1 ? '' : 's'} across ${filesChanged} file${filesChanged === 1 ? '' : 's'}. The result cards show the diffs; re-read the files for the full result.`
}

/** Collapse an edit's replacement text to its first line for the one-line edit listing. */
function singleLine(text: string): string {
  const first = text.split('\n', 1)[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 80)}…` : first
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
    // Replays of logs persisted before the column projection fall back to line-only.
    const at = diagnostic.character === undefined ? String(diagnostic.line) : `${diagnostic.line}:${diagnostic.character}`
    return `${_args.file_path}:${at}  [${label}] ${diagnostic.message}${tail}`
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
  const lines = meta.items.flatMap((item, index) => {
    const label = item.detail === undefined ? item.label : `${item.label} — ${item.detail}`
    const snippet = item.insertText === undefined || item.insertText === item.label ? [] : [`   → ${item.insertText}`]
    return [`${index + 1}. ${label}`, ...snippet]
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

export interface CodeActionToolArgs {
  readonly file_path: string
}

export interface SymbolsToolArgs {
  readonly query?: string
  readonly file_path?: string
}

export interface SignatureToolArgs {
  readonly file_path: string
  readonly line: number
  readonly character: number
}

export interface InlayHintsToolArgs {
  readonly file_path: string
}

/**
 * Pending-state presenter for `lsp_code_action`: a generic search card on the file.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspCodeActionCall(args: CodeActionToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `LSP code actions ${args.file_path}`,
    locations: [{ path: args.file_path }],
  }
}

/**
 * Completed-state presenter for `lsp_code_action`: the reference-only action list.
 * @param _args - the raw tool arguments.
 * @param result - the completed tool result.
 * @returns the generic result view, or undefined to keep the fallback card.
 */
export function presentLspCodeActionResult(_args: CodeActionToolArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta as Partial<CodeActionCardMeta> | undefined
  if (meta === undefined || !Array.isArray(meta.items)) return undefined
  if (meta.items.length === 0) {
    return { card: 'generic', title: `No code actions for ${_args.file_path}`, content: [{ type: 'text', text: 'No code actions available.' }] }
  }
  const lines = meta.items.map((item, index) => {
    const tags = [item.kind ?? '', item.isPreferred === true ? 'preferred' : ''].filter(tag => tag !== '').join(', ')
    return `${index + 1}. ${item.title}${tags === '' ? '' : ` [${tags}]`}`
  })
  return {
    card: 'generic',
    title: `${meta.items.length} code action${meta.items.length === 1 ? '' : 's'} for ${_args.file_path}`,
    content: [{ type: 'text', text: `Reference only — nothing was applied.\n${lines.join('\n')}` }],
  }
}

/**
 * Pending-state presenter for `lsp_symbols`: a generic search card.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspSymbolsCall(args: SymbolsToolArgs): GenericCallView {
  const subject = args.query !== undefined ? `"${args.query}"` : args.file_path ?? ''
  return {
    card: 'generic',
    kind: 'search',
    title: `LSP symbols ${subject}`,
    ...args.file_path === undefined ? {} : { locations: [{ path: args.file_path }] },
  }
}

/**
 * Completed-state presenter for `lsp_symbols`: name, kind, and location lines.
 * @param _args - the raw tool arguments.
 * @param result - the completed tool result.
 * @returns the generic result view, or undefined to keep the fallback card.
 */
export function presentLspSymbolsResult(_args: SymbolsToolArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta as Partial<SymbolsCardMeta> | undefined
  if (meta === undefined || !Array.isArray(meta.items)) return undefined
  if (meta.items.length === 0) {
    return { card: 'generic', title: 'No symbols found', content: [{ type: 'text', text: 'No symbols found.' }] }
  }
  const lines = meta.items.map(item => (
    `${item.name} [${symbolKindLabel(item.kind)}] at ${item.location.uri}:${item.location.line}:${item.location.character}`
  ))
  return { card: 'generic', title: `${meta.items.length} symbol${meta.items.length === 1 ? '' : 's'}`, content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Pending-state presenter for `lsp_signature`: a generic search card at the cursor.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspSignatureCall(args: SignatureToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `LSP signature ${args.file_path}:${args.line}:${args.character}`,
    locations: [{ path: args.file_path, line: args.line }],
  }
}

/**
 * Completed-state presenter for `lsp_signature`: the signature labels.
 * @param _args - the raw tool arguments.
 * @param result - the completed tool result.
 * @returns the generic result view, or undefined to keep the fallback card.
 */
export function presentLspSignatureResult(_args: SignatureToolArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta as Partial<SignaturesCardMeta> | undefined
  if (meta === undefined || !Array.isArray(meta.signatures)) return undefined
  if (meta.signatures.length === 0) {
    return { card: 'generic', title: `No signatures at ${_args.file_path}:${_args.line}:${_args.character}`, content: [{ type: 'text', text: 'No signatures available.' }] }
  }
  const lines = meta.signatures.map((signature, index) => (
    `${index + 1}. ${signature.label}${signature.documentation === undefined ? '' : ` — ${signature.documentation}`}`
  ))
  return { card: 'generic', title: `${meta.signatures.length} signature${meta.signatures.length === 1 ? '' : 's'} at ${_args.file_path}:${_args.line}:${_args.character}`, content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Pending-state presenter for `lsp_inlay_hints`: a generic search card on the file.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspInlayHintsCall(args: InlayHintsToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `LSP inlay hints ${args.file_path}`,
    locations: [{ path: args.file_path }],
  }
}

/**
 * Completed-state presenter for `lsp_inlay_hints`: one line per hint.
 * @param _args - the raw tool arguments.
 * @param result - the completed tool result.
 * @returns the generic result view, or undefined to keep the fallback card.
 */
export function presentLspInlayHintsResult(_args: InlayHintsToolArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta as Partial<InlayHintsCardMeta> | undefined
  if (meta === undefined || !Array.isArray(meta.items)) return undefined
  if (meta.items.length === 0) {
    return { card: 'generic', title: `No inlay hints for ${_args.file_path}`, content: [{ type: 'text', text: 'No inlay hints available.' }] }
  }
  const lines = meta.items.map(item => `${item.line}:${item.character}  ${item.label}`)
  return { card: 'generic', title: `${meta.items.length} inlay hint${meta.items.length === 1 ? '' : 's'} for ${_args.file_path}`, content: [{ type: 'text', text: lines.join('\n') }] }
}

export interface RenameToolArgs {
  readonly file_path: string
  readonly line: number
  readonly character: number
  readonly new_name: string
}

/**
 * Pending-state presenter for `lsp_rename`: the diffs exist only after the server answers, so the
 * pending card is a generic edit card; the completed diff cards replace it.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspRenameCall(args: RenameToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'edit',
    title: `Rename at ${args.file_path}:${args.line}:${args.character} to ${args.new_name}`,
    locations: [{ path: args.file_path, line: args.line }],
  }
}

/**
 * Completed-state presenter for `lsp_rename`: one applied diff card per changed file, rebuilt
 * from the persisted projection so replay reproduces the cards without re-reading the files.
 * @param args - the raw tool arguments (used for the title).
 * @param result - the completed tool result.
 * @returns the diff result view, or undefined to keep the fallback card.
 */
export function presentLspRenameResult(args: RenameToolArgs, result: ToolResult): DiffResultView | undefined {
  if (result.isError) return undefined
  const meta = result.meta as Partial<RenameCardMeta> | undefined
  if (meta === undefined || !Array.isArray(meta.diffs)) return undefined
  return { card: 'diff', title: `Rename to ${args.new_name}`, diffs: [...meta.diffs] }
}
