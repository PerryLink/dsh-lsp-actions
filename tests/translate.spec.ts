import { describe, expect, it } from 'vitest'
import {
  negotiatePositionEncoding,
  normalizeCompletionItems,
  normalizeDiagnostics,
  normalizeEdits,
  requestMethod,
  supportsAction,
  supportsPullDiagnostics,
  supportsTransientOpen,
} from '../src/translate.ts'

const CAPS = {
  textDocumentSync: { openClose: true },
  completionProvider: {},
  documentFormattingProvider: true,
  documentRangeFormattingProvider: true,
  diagnosticProvider: {},
}

describe('requestMethod', () => {
  it('maps each action to its textDocument method', () => {
    expect(requestMethod({ operation: 'diagnostics' })).toBe('textDocument/diagnostic')
    expect(requestMethod({ operation: 'completion' })).toBe('textDocument/completion')
    expect(requestMethod({ operation: 'formatDocument' })).toBe('textDocument/formatting')
    expect(requestMethod({ operation: 'formatDocument', range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } }))
      .toBe('textDocument/rangeFormatting')
  })
})

describe('supportsAction', () => {
  it('gates completion on completionProvider', () => {
    expect(supportsAction(CAPS, 'completion', false)).toBe(true)
    expect(supportsAction({}, 'completion', false)).toBe(false)
    expect(supportsAction({ completionProvider: false }, 'completion', false)).toBe(false)
  })

  it('gates formatting on the matching provider by range presence', () => {
    expect(supportsAction(CAPS, 'formatDocument', false)).toBe(true)
    expect(supportsAction(CAPS, 'formatDocument', true)).toBe(true)
    expect(supportsAction({ documentFormattingProvider: true }, 'formatDocument', false)).toBe(true)
    expect(supportsAction({ documentFormattingProvider: true }, 'formatDocument', true)).toBe(false)
    expect(supportsAction({}, 'formatDocument', false)).toBe(false)
  })

  it('always services diagnostics (pull or push path)', () => {
    expect(supportsAction({}, 'diagnostics', false)).toBe(true)
  })
})

describe('supportsPullDiagnostics', () => {
  it('requires a present diagnosticProvider', () => {
    expect(supportsPullDiagnostics({ diagnosticProvider: {} })).toBe(true)
    expect(supportsPullDiagnostics({ diagnosticProvider: false })).toBe(false)
    expect(supportsPullDiagnostics({})).toBe(false)
  })
})

describe('supportsTransientOpen', () => {
  it('accepts the legacy enum forms 1 and 2, not 0', () => {
    expect(supportsTransientOpen(1)).toBe(true)
    expect(supportsTransientOpen(2)).toBe(true)
    expect(supportsTransientOpen(0)).toBe(false)
  })

  it('requires openClose: true in the options form', () => {
    expect(supportsTransientOpen({ openClose: true })).toBe(true)
    expect(supportsTransientOpen({ openClose: false })).toBe(false)
    expect(supportsTransientOpen({})).toBe(false)
    expect(supportsTransientOpen(undefined)).toBe(false)
  })
})

describe('negotiatePositionEncoding', () => {
  it('accepts utf-16 and the protocol default', () => {
    expect(negotiatePositionEncoding(undefined)).toBe('utf-16')
    expect(negotiatePositionEncoding('utf-16')).toBe('utf-16')
  })

  it('rejects any other encoding', () => {
    expect(() => negotiatePositionEncoding('utf-8')).toThrow(/requires utf-16/)
  })
})

describe('normalizeDiagnostics', () => {
  it('normalizes a pull report and defaults a missing severity to 1', () => {
    const result = normalizeDiagnostics({
      kind: 'full',
      items: [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'm' },
        { severity: 2, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, message: 'w', source: 's', code: 'c1' },
        { severity: 3, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }, message: 'i', code: 7 },
      ],
    })
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'm' })
    expect(result[1]).toEqual({
      severity: 2,
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
      message: 'w',
      source: 's',
      code: 'c1',
    })
    expect(result[2]?.code).toBe(7)
  })

  it('accepts a pushed array and null/undefined as empty', () => {
    expect(normalizeDiagnostics([{ severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, message: 'x' }])).toHaveLength(1)
    expect(normalizeDiagnostics(null)).toEqual([])
    expect(normalizeDiagnostics(undefined)).toEqual([])
  })

  it.each([
    ['a non-object entry', [42]],
    ['a missing message', [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }]],
    ['a missing range', [{ message: 'm' }]],
    ['a bad severity', [{ severity: 9, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, message: 'm' }]],
    ['a non-object payload', 'nope'],
  ])('rejects %s as malformed', (_label, payload) => {
    expect(() => normalizeDiagnostics(payload)).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
  })
})

describe('normalizeEdits', () => {
  it('normalizes text edits and accepts null as empty', () => {
    const edits = normalizeEdits([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: '\t' },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, newText: '' },
    ])
    expect(edits).toEqual([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: '\t' },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, newText: '' },
    ])
    expect(normalizeEdits(null)).toEqual([])
  })

  it.each([
    ['a missing payload', undefined],
    ['a non-array payload', { edits: [] }],
    ['an entry without newText', [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }]],
    ['a non-object entry', ['x']],
  ])('rejects %s as malformed', (_label, payload) => {
    expect(() => normalizeEdits(payload)).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
  })
})

describe('normalizeCompletionItems', () => {
  it('normalizes an item array with every optional field', () => {
    const items = normalizeCompletionItems([
      { label: 'a', kind: 1, detail: 'd', insertText: 'a', sortText: 'a', textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'a' } },
      { label: 'b' },
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      label: 'a',
      kind: 1,
      detail: 'd',
      insertText: 'a',
      sortText: 'a',
      textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'a' },
    })
    expect(items[1]).toEqual({ label: 'b' })
  })

  it('unwraps a CompletionList and accepts null as empty', () => {
    expect(normalizeCompletionItems({ isIncomplete: true, items: [{ label: 'x' }] })).toEqual([{ label: 'x' }])
    expect(normalizeCompletionItems(null)).toEqual([])
  })

  it.each([
    ['a missing payload', undefined],
    ['an item without a label', [{ detail: 'd' }]],
    ['a non-integer kind', [{ label: 'a', kind: 'x' }]],
    ['a non-object textEdit', [{ label: 'a', textEdit: 'x' }]],
  ])('rejects %s as malformed', (_label, payload) => {
    expect(() => normalizeCompletionItems(payload)).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
  })
})
