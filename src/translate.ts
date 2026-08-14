/**
 * Pure protocol translation for the LSP action client: method names, capability gating, position
 * encoding negotiation, and the strict normalizers that turn untrusted wire payloads into the
 * action vocabulary. No I/O or process state — every function is a pure transform.
 * @module dsh-lsp-actions/translate
 */

import type {
  LspActionOperation,
  LspCodeActionItem,
  LspCompletionItem,
  LspDiagnostic,
  LspDiagnosticSeverity,
  LspInlayHint,
  LspPosition,
  LspRange,
  LspSignature,
  LspSymbol,
  LspTextEdit,
} from './vocabulary.ts'
import { LspActionError } from './vocabulary.ts'

/** The position encodings this client can serve; `utf-16` is the protocol default. */
export type WirePositionEncoding = 'utf-16' | 'utf-8' | 'utf-32'

/** Loose wire shape of a server's initialize capabilities; accessed by key. */
export type WireServerCapabilities = Record<string, unknown>

/** Loose wire records, narrowed structurally by the normalizers. */
interface WireRangeRecord { start?: unknown; end?: unknown }
interface WireTextEditRecord { range?: unknown; newText?: unknown }
interface WireDiagnosticRecord { range?: unknown; severity?: unknown; message?: unknown; source?: unknown; code?: unknown }
interface WireCompletionRecord { label?: unknown; kind?: unknown; detail?: unknown; insertText?: unknown; textEdit?: unknown; sortText?: unknown }

/**
 * A position decoder for result normalizers: rewrites a server-side position into utf-16. Absent
 * for servers speaking utf-16 (the overwhelming default, and the encoding this client prefers).
 */
export type PositionDecoder = (position: LspPosition) => LspPosition

/**
 * The `textDocument/*` request method for one action request.
 * @param request - operation plus the optional formatting range that selects rangeFormatting.
 * @returns the LSP request method name.
 */
export function requestMethod(request: { operation: LspActionOperation; range?: LspRange }): string {
  switch (request.operation) {
    case 'diagnostics': return 'textDocument/diagnostic'
    case 'completion': return 'textDocument/completion'
    case 'formatDocument': return request.range === undefined ? 'textDocument/formatting' : 'textDocument/rangeFormatting'
    case 'codeAction': return 'textDocument/codeAction'
    case 'workspaceSymbol': return 'workspace/symbol'
    case 'documentSymbol': return 'textDocument/documentSymbol'
    case 'signatureHelp': return 'textDocument/signatureHelp'
    case 'inlayHint': return 'textDocument/inlayHint'
  }
}

/** Whether a provider capability value counts as present (`true` or an options object). */
function present(value: unknown): boolean {
  return value !== undefined && value !== false
}

/**
 * Whether the server advertises the requested action. Diagnostics is always servable: pull when the
 * server advertises a diagnostic provider, otherwise the open→push→settle path.
 * @param capabilities - the server's initialize capabilities.
 * @param operation - the action to check.
 * @param hasRange - whether a formatDocument request carries a range (selects the range provider).
 * @returns true when the capability is advertised.
 */
export function supportsAction(capabilities: WireServerCapabilities, operation: LspActionOperation, hasRange: boolean): boolean {
  switch (operation) {
    case 'diagnostics': return true
    case 'formatDocument': return present(capabilities[hasRange ? 'documentRangeFormattingProvider' : 'documentFormattingProvider'])
    case 'completion': return present(capabilities.completionProvider)
    case 'codeAction': return present(capabilities.codeActionProvider)
    case 'workspaceSymbol': return present(capabilities.workspaceSymbolProvider)
    case 'documentSymbol': return present(capabilities.documentSymbolProvider)
    case 'signatureHelp': return present(capabilities.signatureHelpProvider)
    case 'inlayHint': return present(capabilities.inlayHintProvider)
  }
}

/**
 * Whether the server advertises pull diagnostics (`diagnosticProvider`), selecting the pull request
 * over the open→push→settle path.
 * @param capabilities - the server's initialize capabilities.
 * @returns true when `diagnosticProvider` is present.
 */
export function supportsPullDiagnostics(capabilities: WireServerCapabilities): boolean {
  return present(capabilities.diagnosticProvider)
}

/**
 * Whether a `textDocumentSync` value permits the transient `didOpen`/`didClose` this client relies
 * on. The legacy enum form implies open/close for `Full` (1)/`Incremental` (2); the options form
 * requires an explicit `openClose: true`.
 * @param sync - the server's advertised `textDocumentSync`.
 * @returns true when transient open/close is supported.
 */
export function supportsTransientOpen(sync: unknown): boolean {
  if (typeof sync === 'number') return sync === 1 || sync === 2
  if (sync === null || typeof sync !== 'object') return false
  return (sync as Record<string, unknown>).openClose === true
}

/**
 * Normalize the negotiated position encoding. An omitted encoding defaults to `utf-16`; the
 * client also serves `utf-8` and `utf-32` servers by converting positions through
 * {@link PositionCodec}. Anything else is a protocol error.
 * @param encoding - the server's advertised `positionEncoding`, if any.
 * @returns the negotiated encoding.
 * @throws Error for an encoding outside the supported set.
 */
export function negotiatePositionEncoding(encoding: unknown): WirePositionEncoding {
  if (encoding === undefined) return 'utf-16'
  if (encoding === 'utf-16' || encoding === 'utf-8' || encoding === 'utf-32') return encoding
  throw new Error(`server negotiated unsupported position encoding "${String(encoding)}"; this client supports utf-16, utf-8, and utf-32`)
}

/**
 * Converts zero-based cursor coordinates between position encodings for one document. Line
 * numbers are encoding-independent (newlines are one unit in every encoding); only the character
 * offset INSIDE the line is converted, so the tables map each utf-16 code unit index to its
 * absolute byte (utf-8) or code-point (utf-32) offset, and conversions subtract the line's own
 * base offset on both sides.
 */
export class PositionCodec {
  private readonly utf8: Uint32Array
  private readonly utf32: Uint32Array
  private readonly lineStarts: number[]
  private readonly length: number

  /**
   * @param text - the document text positions are converted against.
   */
  constructor(text: string) {
    this.length = text.length
    const utf8 = new Uint32Array(text.length + 1)
    const utf32 = new Uint32Array(text.length + 1)
    const lineStarts = [0]
    let bytes = 0
    let points = 0
    for (let i = 0; i < text.length;) {
      const codePoint = text.codePointAt(i) as number
      const width = codePoint > 0xffff ? 2 : 1
      // The offset BEFORE the code point at i; both units of a surrogate pair share it.
      utf8[i] = bytes
      utf32[i] = points
      if (width === 2) {
        utf8[i + 1] = bytes
        utf32[i + 1] = points
      }
      if (codePoint === 0x0a) lineStarts.push(i + width)
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
      points += 1
      i += width
    }
    utf8[text.length] = bytes
    utf32[text.length] = points
    this.utf8 = utf8
    this.utf32 = utf32
    this.lineStarts = lineStarts
  }

  /**
   * Convert a utf-16 position to the server's encoding. A character offset inside a surrogate
   * pair (never legal in any encoding) maps to the code point's own offset.
   * @param position - the utf-16 position.
   * @param encoding - the server's position encoding.
   * @returns the converted position (identical for `utf-16`).
   */
  encode(position: LspPosition, encoding: WirePositionEncoding): LspPosition {
    if (encoding === 'utf-16') return position
    const table = encoding === 'utf-8' ? this.utf8 : this.utf32
    const line = Math.min(Math.max(Math.trunc(position.line), 0), this.lineStarts.length - 1)
    const lineStart = this.lineStarts[line] as number
    const lineEnd = this.lineStarts[line + 1] ?? this.length
    const character = Math.min(Math.max(Math.trunc(position.character), 0), lineEnd - lineStart)
    const base = table[lineStart] as number
    return { line, character: (table[lineStart + character] as number) - base }
  }

  /**
   * Convert a server-side position back to utf-16. An offset inside a multi-unit code point
   * (illegal per protocol) maps to the code point's first utf-16 unit.
   * @param position - the position in the server's encoding.
   * @param encoding - the server's position encoding.
   * @returns the utf-16 position (identical for `utf-16`).
   */
  decode(position: LspPosition, encoding: WirePositionEncoding): LspPosition {
    if (encoding === 'utf-16') return position
    const table = encoding === 'utf-8' ? this.utf8 : this.utf32
    const line = Math.min(Math.max(Math.trunc(position.line), 0), this.lineStarts.length - 1)
    const lineStart = this.lineStarts[line] as number
    const base = table[lineStart] as number
    const target = base + Math.max(Math.trunc(position.character), 0)
    let lo = lineStart
    let hi = this.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((table[mid] as number) < target) lo = mid + 1
      else hi = mid
    }
    return { line, character: lo - lineStart }
  }
}

/** Convert a range with the given position converter, or pass it through. */
function convertRange(range: LspRange, convert: PositionDecoder | undefined): LspRange {
  if (convert === undefined) return range
  return { start: convert(range.start), end: convert(range.end) }
}

/** Create the stable structured error for malformed server result payloads. */
function malformedResponse(message: string): LspActionError {
  return new LspActionError(message, 'LSP_ACTION_MALFORMED_RESPONSE')
}

/** Whether a value is a well-formed wire position (nonnegative integer line/character). */
function isWirePosition(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isCoordinate(record.line) && isCoordinate(record.character)
}

/** Whether a value is a nonnegative safe integer. */
function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** Normalize a wire range, throwing on malformed input. */
function toRange(value: unknown, decode: PositionDecoder | undefined): LspRange {
  if (value === null || typeof value !== 'object') throw malformedResponse('LSP range was not an object')
  const record = value as unknown as WireRangeRecord
  if (!isWirePosition(record.start)) throw malformedResponse('LSP range was missing a valid start position')
  if (!isWirePosition(record.end)) throw malformedResponse('LSP range was missing a valid end position')
  const start = record.start as { line: number; character: number }
  const end = record.end as { line: number; character: number }
  return convertRange({ start, end }, decode)
}

/**
 * Normalize a `textDocument/diagnostic` pull report (`{ kind, items }`) or a pushed `Diagnostic[]`
 * into the action vocabulary. `null`/`undefined` items normalize to an empty list.
 * @param payload - the raw diagnostic payload.
 * @param decode - optional server-side position decoder (utf-8/utf-32 servers).
 * @returns the normalized diagnostics.
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeDiagnostics(payload: unknown, decode?: PositionDecoder): LspDiagnostic[] {
  if (payload === null || payload === undefined) return []
  if (typeof payload !== 'object') throw malformedResponse('LSP diagnostics result was not an object or array')
  const record = payload as Record<string, unknown>
  const items = Array.isArray(payload) ? payload : record.items
  if (!Array.isArray(items)) throw malformedResponse('LSP diagnostics result had no items array')
  return items.map(item => normalizeDiagnostic(item, decode))
}

/** Normalize one wire diagnostic. */
function normalizeDiagnostic(value: unknown, decode: PositionDecoder | undefined): LspDiagnostic {
  if (value === null || typeof value !== 'object') {
    throw malformedResponse('LSP diagnostics contained a non-object entry')
  }
  const record = value as unknown as WireDiagnosticRecord
  const range = toRange(record.range, decode)
  if (typeof record.message !== 'string') throw malformedResponse('LSP diagnostic had no message string')
  const severity = record.severity === undefined ? 1 : record.severity
  if (typeof severity !== 'number' || !Number.isInteger(severity) || severity < 1 || severity > 4) {
    throw malformedResponse('LSP diagnostic severity must be an integer from 1 to 4')
  }
  if (record.source !== undefined && typeof record.source !== 'string') {
    throw malformedResponse('LSP diagnostic source must be a string')
  }
  if (record.code !== undefined && typeof record.code !== 'string' && typeof record.code !== 'number') {
    throw malformedResponse('LSP diagnostic code must be a string or number')
  }
  return {
    severity: severity as LspDiagnosticSeverity,
    range,
    message: record.message,
    ...record.source === undefined ? {} : { source: record.source },
    ...record.code === undefined ? {} : { code: record.code },
  }
}

/**
 * Normalize a formatting result (`TextEdit[]` or `null`) into the action vocabulary.
 * @param payload - the raw `textDocument/formatting|rangeFormatting` result.
 * @param decode - optional server-side position decoder (utf-8/utf-32 servers).
 * @returns the normalized edits (empty for `null`).
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeEdits(payload: unknown, decode?: PositionDecoder): LspTextEdit[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP formatting result was missing')
  if (!Array.isArray(payload)) throw malformedResponse('LSP formatting result was not an array')
  return payload.map(value => normalizeEdit(value, decode))
}

/** Normalize one wire text edit. */
function normalizeEdit(value: unknown, decode: PositionDecoder | undefined): LspTextEdit {
  if (value === null || typeof value !== 'object') {
    throw malformedResponse('LSP formatting result contained a non-object entry')
  }
  const record = value as unknown as WireTextEditRecord
  const range = toRange(record.range, decode)
  if (typeof record.newText !== 'string') throw malformedResponse('LSP text edit had no newText string')
  return { range, newText: record.newText }
}

/**
 * Normalize a completion result (`CompletionItem[]`, a `CompletionList`, or `null`) into the action
 * vocabulary.
 * @param payload - the raw `textDocument/completion` result.
 * @param decode - optional server-side position decoder (utf-8/utf-32 servers).
 * @returns the normalized items (empty for `null`).
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeCompletionItems(payload: unknown, decode?: PositionDecoder): LspCompletionItem[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP completion result was missing')
  if (typeof payload !== 'object') throw malformedResponse('LSP completion result was not an object or array')
  const record = payload as Record<string, unknown>
  const items = Array.isArray(payload) ? payload : record.items
  if (!Array.isArray(items)) throw malformedResponse('LSP completion result had no items array')
  return items.map(item => normalizeCompletionItem(item, decode))
}

/** Normalize one wire completion item. */
function normalizeCompletionItem(value: unknown, decode: PositionDecoder | undefined): LspCompletionItem {
  if (value === null || typeof value !== 'object') {
    throw malformedResponse('LSP completion contained a non-object entry')
  }
  const record = value as unknown as WireCompletionRecord
  if (typeof record.label !== 'string') throw malformedResponse('LSP completion item had no label string')
  if (record.kind !== undefined && (typeof record.kind !== 'number' || !Number.isInteger(record.kind))) {
    throw malformedResponse('LSP completion item kind must be an integer')
  }
  if (record.detail !== undefined && typeof record.detail !== 'string') {
    throw malformedResponse('LSP completion item detail must be a string')
  }
  if (record.insertText !== undefined && typeof record.insertText !== 'string') {
    throw malformedResponse('LSP completion item insertText must be a string')
  }
  if (record.sortText !== undefined && typeof record.sortText !== 'string') {
    throw malformedResponse('LSP completion item sortText must be a string')
  }
  let textEdit: LspTextEdit | undefined
  if (record.textEdit !== undefined) {
    if (record.textEdit === null || typeof record.textEdit !== 'object') {
      throw malformedResponse('LSP completion item textEdit must be an object')
    }
    const edit = record.textEdit as unknown as WireTextEditRecord
    textEdit = { range: toRange(edit.range, decode), newText: requireString(edit.newText, 'textEdit.newText') }
  }
  return {
    label: record.label,
    ...record.kind === undefined ? {} : { kind: record.kind },
    ...record.detail === undefined ? {} : { detail: record.detail },
    ...record.insertText === undefined ? {} : { insertText: record.insertText },
    ...record.sortText === undefined ? {} : { sortText: record.sortText },
    ...textEdit === undefined ? {} : { textEdit },
  }
}

/** Require a string field, throwing the shared malformed-response error. */
function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw malformedResponse(`LSP completion item ${name} must be a string`)
  return value
}

/**
 * Normalize a `textDocument/codeAction` result (`(Command | CodeAction)[]` or `null`) into the
 * action vocabulary. Edits are grouped by target document URI; a `Command` form is reported
 * verbatim and never executed. Non-text workspace edits (create/rename/delete) are dropped —
 * applying code actions is the model's own write/edit decision.
 * @param payload - the raw code action result.
 * @param decode - optional server-side position decoder (utf-8/utf-32 servers).
 * @returns the normalized actions (empty for `null`).
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeCodeActions(payload: unknown, decode?: PositionDecoder): LspCodeActionItem[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP code action result was missing')
  if (!Array.isArray(payload)) throw malformedResponse('LSP code action result was not an array')
  return payload.map(value => normalizeCodeAction(value, decode))
}

/** Normalize one wire code action (Command or CodeAction form). */
function normalizeCodeAction(value: unknown, decode: PositionDecoder | undefined): LspCodeActionItem {
  if (value === null || typeof value !== 'object') {
    throw malformedResponse('LSP code action result contained a non-object entry')
  }
  const record = value as Record<string, unknown>
  if (typeof record.title !== 'string') throw malformedResponse('LSP code action had no title string')
  const kind = record.kind === undefined ? undefined : requireString(record.kind, 'kind')
  const isPreferred = record.isPreferred === undefined ? undefined : requireBoolean(record.isPreferred, 'isPreferred')
  // Command form: no edits, only a reference to a server command (never executed).
  if (record.command !== undefined) {
    if (record.command === null || typeof record.command !== 'object') {
      throw malformedResponse('LSP code action command must be an object')
    }
    const wire = record.command as Record<string, unknown>
    if (typeof wire.command !== 'string') throw malformedResponse('LSP code action command had no command string')
    return {
      title: record.title,
      ...kind === undefined ? {} : { kind },
      ...isPreferred === undefined ? {} : { isPreferred },
      edits: {},
      command: {
        title: typeof wire.title === 'string' ? wire.title : record.title,
        command: wire.command,
        ...wire.arguments === undefined ? {} : { arguments: wire.arguments },
      },
    }
  }
  const edits: Record<string, LspTextEdit[]> = {}
  const wireEdit = record.edit
  if (wireEdit !== undefined) {
    if (wireEdit === null || typeof wireEdit !== 'object') throw malformedResponse('LSP code action edit must be an object')
    const editRecord = wireEdit as Record<string, unknown>
    if (editRecord.changes !== undefined) {
      collectWorkspaceEdits(editRecord.changes, decode, edits)
    }
    if (Array.isArray(editRecord.documentChanges)) {
      for (const change of editRecord.documentChanges) {
        if (change === null || typeof change !== 'object') continue
        const changeRecord = change as Record<string, unknown>
        if (changeRecord.kind !== undefined) continue // create/rename/delete: not applicable here
        const doc = changeRecord.textDocument as { uri?: unknown } | undefined
        if (doc === null || typeof doc !== 'object' || typeof doc.uri !== 'string') continue
        if (!Array.isArray(changeRecord.edits)) continue
        for (const edit of changeRecord.edits) {
          ;(edits[doc.uri] ??= []).push(normalizeEdit(edit, decode))
        }
      }
    }
  }
  return {
    title: record.title,
    ...kind === undefined ? {} : { kind },
    ...isPreferred === undefined ? {} : { isPreferred },
    edits,
  }
}

/** Collect a wire `changes` map (`uri` → `TextEdit[]`) into the grouped edit record. */
function collectWorkspaceEdits(changes: unknown, decode: PositionDecoder | undefined, into: Record<string, LspTextEdit[]>): void {
  if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) {
    throw malformedResponse('LSP code action changes must be an object')
  }
  for (const [uri, wireEdits] of Object.entries(changes as Record<string, unknown>)) {
    if (!Array.isArray(wireEdits)) throw malformedResponse('LSP code action changes held a non-array edit list')
    const normalized = wireEdits.map(edit => normalizeEdit(edit, decode))
    if (normalized.length > 0) {
      const existing = into[uri]
      if (existing === undefined) into[uri] = normalized
      else existing.push(...normalized)
    }
  }
}

/**
 * Normalize a `workspace/symbol` or `textDocument/documentSymbol` result into the action
 * vocabulary. DocumentSymbol hierarchies are flattened depth-first, each node carrying its own
 * range; SymbolInformation locations pass through verbatim.
 * @param payload - the raw symbol result.
 * @param documentUri - the URI DocumentSymbol entries belong to.
 * @param decode - optional server-side position decoder (utf-8/utf-32 servers).
 * @returns the normalized symbols (empty for `null`).
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeSymbols(payload: unknown, documentUri: string | undefined, decode?: PositionDecoder): LspSymbol[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP symbol result was missing')
  if (!Array.isArray(payload)) throw malformedResponse('LSP symbol result was not an array')
  const symbols: LspSymbol[] = []
  for (const entry of payload) {
    if (entry === null || typeof entry !== 'object') {
      throw malformedResponse('LSP symbol result contained a non-object entry')
    }
    const record = entry as Record<string, unknown>
    if (record.location !== undefined) {
      symbols.push(normalizeSymbolInformation(record, decode))
    } else if (documentUri !== undefined) {
      flattenDocumentSymbol(record, documentUri, decode, symbols)
    }
  }
  return symbols
}

/** Normalize one SymbolInformation. */
function normalizeSymbolInformation(record: Record<string, unknown>, decode: PositionDecoder | undefined): LspSymbol {
  if (typeof record.name !== 'string') throw malformedResponse('LSP symbol had no name string')
  const kind = requireIntegerField(record.kind, 'kind')
  const location = record.location as { uri?: unknown; range?: unknown } | null
  if (location === null || typeof location !== 'object') throw malformedResponse('LSP symbol had no location object')
  if (typeof location.uri !== 'string') throw malformedResponse('LSP symbol location had no uri string')
  return {
    name: record.name,
    kind,
    location: { uri: location.uri, range: toRange(location.range, decode) },
    ...typeof record.containerName === 'string' ? { containerName: record.containerName } : {},
  }
}

/** Flatten one DocumentSymbol node (with its children) into the list. */
function flattenDocumentSymbol(
  record: Record<string, unknown>,
  documentUri: string,
  decode: PositionDecoder | undefined,
  into: LspSymbol[],
): void {
  if (typeof record.name !== 'string') throw malformedResponse('LSP document symbol had no name string')
  const kind = requireIntegerField(record.kind, 'kind')
  into.push({
    name: record.name,
    kind,
    location: { uri: documentUri, range: toRange(record.range, decode) },
    ...typeof record.containerName === 'string' ? { containerName: record.containerName } : {},
  })
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      if (child === null || typeof child !== 'object') throw malformedResponse('LSP document symbol child was not an object')
      flattenDocumentSymbol(child as Record<string, unknown>, documentUri, decode, into)
    }
  }
}

/**
 * Normalize a `textDocument/signatureHelp` result into the action vocabulary. Documentation is
 * normalized from MarkupContent to plain text; tuple parameter labels are sliced out of the
 * signature label.
 * @param payload - the raw signature help result.
 * @returns the normalized signatures, or `{ signatures: [] }`-equivalent null result.
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeSignatures(payload: unknown): { signatures: LspSignature[]; activeSignature?: number; activeParameter?: number } {
  if (payload === null) return { signatures: [] }
  if (payload === undefined || typeof payload !== 'object') throw malformedResponse('LSP signature help result was not an object')
  const record = payload as Record<string, unknown>
  if (!Array.isArray(record.signatures)) throw malformedResponse('LSP signature help had no signatures array')
  const signatures = record.signatures.map(normalizeSignature)
  return {
    signatures,
    ...typeof record.activeSignature === 'number' ? { activeSignature: record.activeSignature } : {},
    ...typeof record.activeParameter === 'number' ? { activeParameter: record.activeParameter } : {},
  }
}

/** Normalize one SignatureInformation. */
function normalizeSignature(value: unknown): LspSignature {
  if (value === null || typeof value !== 'object') throw malformedResponse('LSP signature help contained a non-object entry')
  const record = value as Record<string, unknown>
  if (typeof record.label !== 'string') throw malformedResponse('LSP signature had no label string')
  const labelText: string = record.label
  let parameters: { label: string; documentation?: string }[] | undefined
  if (record.parameters !== undefined) {
    if (!Array.isArray(record.parameters)) throw malformedResponse('LSP signature parameters must be an array')
    parameters = record.parameters.map((parameter) => {
      const p = parameter as Record<string, unknown> | null
      if (p === null || typeof p !== 'object') throw malformedResponse('LSP signature parameter was not an object')
      const wire = p.label
      let label: string
      if (typeof wire === 'string') {
        label = wire
      } else if (Array.isArray(wire) && typeof wire[0] === 'number' && typeof wire[1] === 'number') {
        label = labelText.slice(wire[0], wire[1])
      } else {
        throw malformedResponse('LSP signature parameter label must be a string or a [start, end] tuple')
      }
      return {
        label,
        ...p.documentation === undefined ? {} : { documentation: markupText(p.documentation) },
      }
    })
  }
  return {
    label: labelText,
    ...record.documentation === undefined ? {} : { documentation: markupText(record.documentation) },
    ...parameters === undefined ? {} : { parameters },
  }
}

/**
 * Normalize a `textDocument/inlayHint` result into the action vocabulary. Multi-part labels are
 * joined into plain text.
 * @param payload - the raw inlay hint result.
 * @param decode - optional server-side position decoder (utf-8/utf-32 servers).
 * @returns the normalized hints (empty for `null`).
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeInlayHints(payload: unknown, decode?: PositionDecoder): LspInlayHint[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP inlay hint result was missing')
  if (!Array.isArray(payload)) throw malformedResponse('LSP inlay hint result was not an array')
  return payload.map((value) => {
    if (value === null || typeof value !== 'object') throw malformedResponse('LSP inlay hint result contained a non-object entry')
    const record = value as Record<string, unknown>
    const position = isWirePosition(record.position)
      ? toRange({ start: record.position, end: record.position }, decode).start
      : undefined
    if (position === undefined) throw malformedResponse('LSP inlay hint had no valid position')
    const wireLabel = record.label
    let label: string
    if (typeof wireLabel === 'string') {
      label = wireLabel
    } else if (Array.isArray(wireLabel)) {
      const parts: string[] = []
      for (const part of wireLabel) {
        if (part === null || typeof part !== 'object' || typeof (part as Record<string, unknown>).value !== 'string') {
          throw malformedResponse('LSP inlay hint label part had no value string')
        }
        parts.push((part as Record<string, unknown>).value as string)
      }
      label = parts.join('')
    } else {
      throw malformedResponse('LSP inlay hint label must be a string or a part array')
    }
    return {
      position,
      label,
      ...record.kind === undefined ? {} : { kind: requireIntegerField(record.kind, 'kind') },
      ...record.paddingLeft === undefined ? {} : { paddingLeft: requireBoolean(record.paddingLeft, 'paddingLeft') },
      ...record.paddingRight === undefined ? {} : { paddingRight: requireBoolean(record.paddingRight, 'paddingRight') },
    }
  })
}

/** Require an integer field, throwing the shared malformed-response error. */
function requireIntegerField(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw malformedResponse(`LSP ${name} must be an integer`)
  }
  return value
}

/** Require a boolean field, throwing the shared malformed-response error. */
function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw malformedResponse(`LSP ${name} must be a boolean`)
  return value
}

/** Normalize `string | MarkupContent` documentation to plain text. */
function markupText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') throw malformedResponse('LSP documentation must be a string or MarkupContent')
  const record = value as Record<string, unknown>
  if (typeof record.value !== 'string') throw malformedResponse('LSP MarkupContent had no value string')
  return record.value
}
