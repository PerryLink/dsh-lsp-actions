/**
 * Apply a server's text edits to the document text the server saw: position→offset conversion on
 * UTF-16 code units, overlap validation, and descending application so non-overlapping edits can
 * never shift one another's offsets.
 * @module dsh-lsp-actions/edits
 */

import type { LspPosition, LspTextEdit } from './vocabulary.ts'
import { LspActionError } from './vocabulary.ts'

/** One edit converted to absolute UTF-16 offsets. */
interface LocatedEdit {
  readonly start: number
  readonly end: number
  readonly newText: string
}

/**
 * Apply a server's non-overlapping edits to the exact text the server edited, in descending
 * position order so earlier edits never invalidate later offsets.
 * @param text - the document text the server saw.
 * @param edits - the normalized edits.
 * @returns the text with every edit applied.
 * @throws LspActionError LSP_ACTION_CONFLICT for overlapping edits or edits outside the document.
 */
export function applyEdits(text: string, edits: readonly LspTextEdit[]): string {
  const lineStarts = computeLineStarts(text)
  const located = edits.map(edit => ({
    start: offsetAt(lineStarts, text, edit.range.start, 'start'),
    end: offsetAt(lineStarts, text, edit.range.end, 'end'),
    newText: edit.newText,
  }))
  located.sort((a, b) => a.start - b.start)
  for (let i = 1; i < located.length; i++) {
    if (located[i].start < located[i - 1].end) {
      throw new LspActionError(
        'the language server returned overlapping text edits; refusing to apply them',
        'LSP_ACTION_CONFLICT',
      )
    }
  }
  let result = text
  for (let i = located.length - 1; i >= 0; i--) {
    const edit = located[i] as LocatedEdit
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end)
  }
  return result
}

/** The UTF-16 offset where each line starts, plus a `text.length` sentinel. */
function computeLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  starts.push(text.length)
  return starts
}

/**
 * Convert a zero-based position to an absolute UTF-16 offset. The character may equal the line's
 * length (a cursor or insertion point at the line end); beyond that the position is outside the
 * document.
 * @param lineStarts - the precomputed line start offsets.
 * @param text - the document text.
 * @param position - the position to convert.
 * @param side - which range end is being converted, for the error message.
 * @returns the absolute offset.
 * @throws LspActionError LSP_ACTION_CONFLICT when the position lies outside the document.
 */
function offsetAt(lineStarts: number[], text: string, position: LspPosition, side: 'start' | 'end'): number {
  const line = position.line
  if (!Number.isInteger(line) || line < 0 || line >= lineStarts.length - 1) {
    throw outOfBounds(position, side)
  }
  const lineStart = lineStarts[line] as number
  const nextStart = lineStarts[line + 1] as number
  // The last line has no trailing newline; other lines end before their newline character.
  const lineEnd = nextStart === text.length ? text.length : nextStart - 1
  const target = lineStart + position.character
  if (!Number.isInteger(position.character) || position.character < 0 || target > lineEnd) {
    throw outOfBounds(position, side)
  }
  return target
}

/** Create the out-of-bounds conflict error. */
function outOfBounds(position: LspPosition, side: 'start' | 'end'): LspActionError {
  return new LspActionError(
    `the language server returned a text edit with an out-of-bounds ${side} position ${position.line}:${position.character}`,
    'LSP_ACTION_CONFLICT',
  )
}
