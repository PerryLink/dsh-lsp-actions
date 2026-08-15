import { describe, expect, it } from 'vitest'
import {
  decodeTextEdits,
  negotiatePositionEncoding,
  normalizeCodeActions,
  normalizeCompletionItems,
  normalizeDiagnostics,
  normalizeEdits,
  normalizeInlayHints,
  normalizeSignatures,
  normalizeSymbols,
  normalizeWorkspaceEdit,
  PositionCodec,
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
    expect(requestMethod({ operation: 'codeAction' })).toBe('textDocument/codeAction')
    expect(requestMethod({ operation: 'workspaceSymbol' })).toBe('workspace/symbol')
    expect(requestMethod({ operation: 'documentSymbol' })).toBe('textDocument/documentSymbol')
    expect(requestMethod({ operation: 'signatureHelp' })).toBe('textDocument/signatureHelp')
    expect(requestMethod({ operation: 'inlayHint' })).toBe('textDocument/inlayHint')
    expect(requestMethod({ operation: 'rename' })).toBe('textDocument/rename')
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

  it('gates the extended actions on their provider capabilities', () => {
    expect(supportsAction({ codeActionProvider: true }, 'codeAction', false)).toBe(true)
    expect(supportsAction({}, 'codeAction', false)).toBe(false)
    expect(supportsAction({ workspaceSymbolProvider: {} }, 'workspaceSymbol', false)).toBe(true)
    expect(supportsAction({}, 'workspaceSymbol', false)).toBe(false)
    expect(supportsAction({ documentSymbolProvider: true }, 'documentSymbol', false)).toBe(true)
    expect(supportsAction({}, 'documentSymbol', false)).toBe(false)
    expect(supportsAction({ signatureHelpProvider: {} }, 'signatureHelp', false)).toBe(true)
    expect(supportsAction({}, 'signatureHelp', false)).toBe(false)
    expect(supportsAction({ inlayHintProvider: {} }, 'inlayHint', false)).toBe(true)
    expect(supportsAction({}, 'inlayHint', false)).toBe(false)
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
  it('accepts the supported encodings and the protocol default', () => {
    expect(negotiatePositionEncoding(undefined)).toBe('utf-16')
    expect(negotiatePositionEncoding('utf-16')).toBe('utf-16')
    expect(negotiatePositionEncoding('utf-8')).toBe('utf-8')
    expect(negotiatePositionEncoding('utf-32')).toBe('utf-32')
  })

  it('rejects an encoding outside the supported set', () => {
    expect(() => negotiatePositionEncoding('utf-7')).toThrow(/utf-16, utf-8, and utf-32/)
  })
})

describe('PositionCodec', () => {
  const text = '😀xx\naéπ\n'

  it('round-trips code-point-aligned positions in both directions for every supported encoding', () => {
    for (const encoding of ['utf-8', 'utf-32'] as const) {
      const codec = new PositionCodec(text)
      // Offsets inside a surrogate pair are not representable in utf-8/utf-32; aligned ones round-trip.
      for (const character of [0, 2, 3, 4]) {
        const encoded = codec.encode({ line: 0, character }, encoding)
        expect(codec.decode(encoded, encoding).character).toBe(character)
      }
      // Line numbers are encoding-independent.
      expect(codec.encode({ line: 1, character: 2 }, encoding).line).toBe(1)
    }
  })

  it('maps utf-16 character offsets to utf-8 bytes across multi-byte code points', () => {
    const codec = new PositionCodec(text)
    // '😀' is 4 bytes / 2 utf-16 units: utf-16 offset 2 ('x') is utf-8 byte 4.
    expect(codec.encode({ line: 0, character: 2 }, 'utf-8').character).toBe(4)
    expect(codec.decode({ line: 0, character: 4 }, 'utf-8').character).toBe(2)
  })

  it('maps utf-16 character offsets to utf-32 code points', () => {
    const codec = new PositionCodec('a😀π\n')
    // 'a😀π': utf-16 1..2 = '😀' (astral), 3..4 = 'π'; utf-32 counts one per code point.
    expect(codec.encode({ line: 0, character: 3 }, 'utf-32').character).toBe(2)
    expect(codec.decode({ line: 0, character: 2 }, 'utf-32').character).toBe(3)
  })

  it('clamps out-of-range offsets to the document bounds', () => {
    const codec = new PositionCodec(text)
    expect(codec.encode({ line: 0, character: 99 }, 'utf-8').character)
      .toBe(codec.encode({ line: 0, character: text.length }, 'utf-8').character)
    expect(codec.decode({ line: 0, character: -3 }, 'utf-8').character).toBe(0)
  })

  it('is the identity for utf-16', () => {
    const codec = new PositionCodec(text)
    const position = { line: 0, character: 3 }
    expect(codec.encode(position, 'utf-16')).toBe(position)
    expect(codec.decode(position, 'utf-16')).toBe(position)
  })

  it('decodes normalizeDiagnostics through the decoder', () => {
    const codec = new PositionCodec(text)
    const decode = (position: { line: number; character: number }) => codec.decode(position, 'utf-8')
    const result = normalizeDiagnostics([
      { severity: 1, range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, message: 'm' },
    ], decode)
    expect(result[0]?.range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 3 } })
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

describe('normalizeCodeActions', () => {
  const changes = {
    'file:///ws/a.ts': [
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: 'fixed' },
    ],
  }

  it('normalizes CodeAction edits grouped by document and Command forms verbatim', () => {
    const actions = normalizeCodeActions([
      { title: 'Fix', kind: 'quickfix', isPreferred: true, edit: { changes } },
      { title: 'Run', command: { title: 'run', command: 'x.run', arguments: [1] } },
    ])
    expect(actions).toHaveLength(2)
    expect(actions[0]).toEqual({
      title: 'Fix',
      kind: 'quickfix',
      isPreferred: true,
      edits: { 'file:///ws/a.ts': [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: 'fixed' }] },
    })
    expect(actions[1]?.command).toEqual({ title: 'run', command: 'x.run', arguments: [1] })
  })

  it('collects TextDocumentEdit documentChanges and drops workspace edits', () => {
    const actions = normalizeCodeActions([
      {
        title: 'DocEdit',
        edit: {
          documentChanges: [
            { textDocument: { uri: 'file:///ws/b.ts' }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }] },
            { kind: 'create', uri: 'file:///ws/new.ts' },
          ],
        },
      },
    ])
    expect(actions[0]?.edits).toEqual({
      'file:///ws/b.ts': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }],
    })
  })

  it('accepts null as empty and rejects malformed payloads', () => {
    expect(normalizeCodeActions(null)).toEqual([])
    expect(() => normalizeCodeActions([{ command: 'x.run' }])).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
    expect(() => normalizeCodeActions([{ title: 't', isPreferred: 'yes' }])).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
    expect(() => normalizeCodeActions([{ title: 't', edit: { changes: 'nope' } }])).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
  })
})

describe('normalizeSymbols', () => {
  it('normalizes SymbolInformation with locations', () => {
    const symbols = normalizeSymbols([
      { name: 'sym', kind: 12, location: { uri: 'file:///ws/a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }, containerName: 'mod' },
    ], undefined)
    expect(symbols).toEqual([{
      name: 'sym',
      kind: 12,
      location: { uri: 'file:///ws/a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
      containerName: 'mod',
    }])
  })

  it('flattens DocumentSymbol hierarchies against the document uri', () => {
    const symbols = normalizeSymbols([
      {
        name: 'parent', kind: 5, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        children: [{ name: 'child', kind: 6, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } }],
      },
    ], 'file:///ws/a.ts')
    expect(symbols.map(symbol => symbol.name)).toEqual(['parent', 'child'])
    expect(symbols[1]?.location.uri).toBe('file:///ws/a.ts')
  })
})

describe('normalizeSignatures', () => {
  it('normalizes labels, markdown documentation, and tuple parameter labels', () => {
    const result = normalizeSignatures({
      signatures: [
        {
          label: 'f(a: number, b: string)',
          documentation: { kind: 'markdown', value: 'docs' },
          parameters: [
            { label: [2, 11], documentation: 'first' },
            { label: 'b: string' },
          ],
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    })
    expect(result.signatures[0]?.label).toBe('f(a: number, b: string)')
    expect(result.signatures[0]?.documentation).toBe('docs')
    expect(result.signatures[0]?.parameters).toEqual([
      { label: 'a: number', documentation: 'first' },
      { label: 'b: string' },
    ])
    expect(result.activeSignature).toBe(0)
    expect(result.activeParameter).toBe(1)
  })

  it('returns empty signatures for null', () => {
    expect(normalizeSignatures(null)).toEqual({ signatures: [] })
  })

  it.each([
    ['a non-object payload', 'nope'],
    ['missing signatures array', {}],
    ['a signature without a label', { signatures: [{}] }],
    ['non-string documentation', { signatures: [{ label: 'f()', documentation: 42 }] }],
    ['a markup without a value', { signatures: [{ label: 'f()', documentation: { kind: 'markdown' } }] }],
    ['a bad parameter label', { signatures: [{ label: 'f()', parameters: [{ label: 42 }] }] }],
  ])('rejects %s as malformed', (_label, payload) => {
    expect(() => normalizeSignatures(payload)).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
  })
})

describe('normalizeInlayHints', () => {
  it('joins multi-part labels and keeps padding markers', () => {
    const hints = normalizeInlayHints([
      { position: { line: 1, character: 0 }, label: [{ value: ': ' }, { value: 'number' }], kind: 1, paddingLeft: true },
    ])
    expect(hints).toEqual([
      { position: { line: 1, character: 0 }, label: ': number', kind: 1, paddingLeft: true },
    ])
  })

  it('decodes positions through the decoder', () => {
    const codec = new PositionCodec('a😀\n')
    const decode = (position: { line: number; character: number }) => codec.decode(position, 'utf-8')
    // utf-8 character 5 on line 0 is the newline position (after the 4-byte emoji): utf-16 3.
    const hints = normalizeInlayHints([{ position: { line: 0, character: 5 }, label: 'hint' }], decode)
    expect(hints[0]?.position).toEqual({ line: 0, character: 3 })
  })

  it('accepts null as empty', () => {
    expect(normalizeInlayHints(null)).toEqual([])
  })

  it.each([
    ['a non-array payload', {}],
    ['a hint without a position', [{ label: 'x' }]],
    ['a hint with a bad label part', [{ position: { line: 0, character: 0 }, label: [{ kind: 1 }] }]],
    ['a non-boolean padding marker', [{ position: { line: 0, character: 0 }, label: 'x', paddingLeft: 'yes' }]],
  ])('rejects %s as malformed', (_label, payload) => {
    expect(() => normalizeInlayHints(payload)).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
  })
})

describe('normalizeWorkspaceEdit', () => {
  const edit = (character: number): unknown => ({
    range: { start: { line: 0, character }, end: { line: 0, character: character + 1 } },
    newText: 'x',
  })

  it('groups a changes map by uri', () => {
    expect(normalizeWorkspaceEdit({ changes: { 'file:///a.ts': [edit(0), edit(5)] } })).toEqual({
      'file:///a.ts': [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'x' },
        { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 6 } }, newText: 'x' },
      ],
    })
  })

  it('normalizes documentChanges text edits and merges with changes', () => {
    expect(normalizeWorkspaceEdit({
      changes: { 'file:///a.ts': [edit(0)] },
      documentChanges: [{ textDocument: { uri: 'file:///b.ts', version: 1 }, edits: [edit(3)] }],
    })).toEqual({
      'file:///a.ts': [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'x' },
      ],
      'file:///b.ts': [
        { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } }, newText: 'x' },
      ],
    })
  })

  it('returns an empty record for a null result', () => {
    expect(normalizeWorkspaceEdit(null)).toEqual({})
  })

  it('refuses resource operations as unsupported', () => {
    expect(() => normalizeWorkspaceEdit({
      documentChanges: [{ kind: 'rename', oldUri: 'file:///a.ts', newUri: 'file:///b.ts' }],
    })).toThrow(expect.objectContaining({ code: 'LSP_ACTION_UNSUPPORTED' }))
  })

  it.each([
    ['a missing payload', undefined],
    ['a non-object payload', 'nope'],
    ['a non-array documentChanges', { documentChanges: {} }],
    ['a documentChange without a textDocument uri', { documentChanges: [{ edits: [] }] }],
    ['a documentChange without edits', { documentChanges: [{ textDocument: { uri: 'file:///a.ts' } }] }],
  ])('rejects %s as malformed', (_label, payload) => {
    expect(() => normalizeWorkspaceEdit(payload)).toThrow(expect.objectContaining({ code: 'LSP_ACTION_MALFORMED_RESPONSE' }))
  })
})

describe('decodeTextEdits', () => {
  it('passes edits through unchanged for utf-16 documents', () => {
    const edits = [{ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: 'x' }]
    expect(decodeTextEdits(edits, undefined, 'utf-16')).toEqual(edits)
  })

  it('decodes utf-8 positions through the document codec', () => {
    const codec = new PositionCodec('éé other')
    const edits = [{ range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } }, newText: 'next' }]
    expect(decodeTextEdits(edits, codec, 'utf-8')).toEqual([
      { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 8 } }, newText: 'next' },
    ])
  })
})
