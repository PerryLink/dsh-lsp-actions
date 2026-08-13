/**
 * Pure protocol translation for the LSP action client: method names, capability gating, position
 * encoding negotiation, and the strict normalizers that turn untrusted wire payloads into the
 * action vocabulary. No I/O or process state — every function is a pure transform.
 * @module dsh-lsp-actions/translate
 */

import type { LspActionOperation, LspCompletionItem, LspDiagnostic, LspDiagnosticSeverity, LspRange, LspTextEdit } from './vocabulary.ts'
import { LspActionError } from './vocabulary.ts'

/** Loose wire shape of a server's initialize capabilities; accessed by key. */
export type WireServerCapabilities = Record<string, unknown>

/** Loose wire records, narrowed structurally by the normalizers. */
interface WireRangeRecord { start?: unknown; end?: unknown }
interface WireTextEditRecord { range?: unknown; newText?: unknown }
interface WireDiagnosticRecord { range?: unknown; severity?: unknown; message?: unknown; source?: unknown; code?: unknown }
interface WireCompletionRecord { label?: unknown; kind?: unknown; detail?: unknown; insertText?: unknown; textEdit?: unknown; sortText?: unknown }

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
 * Normalize the negotiated position encoding. An omitted encoding defaults to `utf-16`; any other
 * value is a protocol error this client does not support.
 * @param encoding - the server's advertised `positionEncoding`, if any.
 * @returns the string `'utf-16'`.
 * @throws Error for any non-`utf-16` encoding.
 */
export function negotiatePositionEncoding(encoding: unknown): 'utf-16' {
  if (encoding === undefined || encoding === 'utf-16') return 'utf-16'
  throw new Error(`server negotiated unsupported position encoding "${String(encoding)}"; this client requires utf-16`)
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
function toRange(value: unknown): LspRange {
  if (value === null || typeof value !== 'object') throw malformedResponse('LSP range was not an object')
  const record = value as unknown as WireRangeRecord
  if (!isWirePosition(record.start)) throw malformedResponse('LSP range was missing a valid start position')
  if (!isWirePosition(record.end)) throw malformedResponse('LSP range was missing a valid end position')
  const start = record.start as { line: number; character: number }
  const end = record.end as { line: number; character: number }
  return { start: { line: start.line, character: start.character }, end: { line: end.line, character: end.character } }
}

/**
 * Normalize a `textDocument/diagnostic` pull report (`{ kind, items }`) or a pushed `Diagnostic[]`
 * into the action vocabulary. `null`/`undefined` items normalize to an empty list.
 * @param payload - the raw diagnostic payload.
 * @returns the normalized diagnostics.
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeDiagnostics(payload: unknown): LspDiagnostic[] {
  if (payload === null || payload === undefined) return []
  if (typeof payload !== 'object') throw malformedResponse('LSP diagnostics result was not an object or array')
  const record = payload as Record<string, unknown>
  const items = Array.isArray(payload) ? payload : record.items
  if (!Array.isArray(items)) throw malformedResponse('LSP diagnostics result had no items array')
  return items.map(normalizeDiagnostic)
}

/** Normalize one wire diagnostic. */
function normalizeDiagnostic(value: unknown): LspDiagnostic {
  if (value === null || typeof value !== 'object') {
    throw malformedResponse('LSP diagnostics contained a non-object entry')
  }
  const record = value as unknown as WireDiagnosticRecord
  const range = toRange(record.range)
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
 * @returns the normalized edits (empty for `null`).
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeEdits(payload: unknown): LspTextEdit[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP formatting result was missing')
  if (!Array.isArray(payload)) throw malformedResponse('LSP formatting result was not an array')
  return payload.map(normalizeEdit)
}

/** Normalize one wire text edit. */
function normalizeEdit(value: unknown): LspTextEdit {
  if (value === null || typeof value !== 'object') {
    throw malformedResponse('LSP formatting result contained a non-object entry')
  }
  const record = value as unknown as WireTextEditRecord
  const range = toRange(record.range)
  if (typeof record.newText !== 'string') throw malformedResponse('LSP text edit had no newText string')
  return { range, newText: record.newText }
}

/**
 * Normalize a completion result (`CompletionItem[]`, a `CompletionList`, or `null`) into the action
 * vocabulary.
 * @param payload - the raw `textDocument/completion` result.
 * @returns the normalized items (empty for `null`).
 * @throws LspActionError LSP_ACTION_MALFORMED_RESPONSE for structurally invalid entries.
 */
export function normalizeCompletionItems(payload: unknown): LspCompletionItem[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP completion result was missing')
  if (typeof payload !== 'object') throw malformedResponse('LSP completion result was not an object or array')
  const record = payload as Record<string, unknown>
  const items = Array.isArray(payload) ? payload : record.items
  if (!Array.isArray(items)) throw malformedResponse('LSP completion result had no items array')
  return items.map(normalizeCompletionItem)
}

/** Normalize one wire completion item. */
function normalizeCompletionItem(value: unknown): LspCompletionItem {
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
    textEdit = { range: toRange(edit.range), newText: requireString(edit.newText, 'textEdit.newText') }
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
