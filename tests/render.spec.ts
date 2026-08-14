import { describe, expect, it } from 'vitest'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import {
  formatAppliedEdits,
  formatCodeActions,
  formatCompletionList,
  formatDiagnostics,
  formatInlayHints,
  formatSignatures,
  formatSymbols,
  presentLspCodeActionCall,
  presentLspCodeActionResult,
  presentLspCompletionCall,
  presentLspCompletionResult,
  presentLspDiagnosticsCall,
  presentLspDiagnosticsResult,
  presentLspFormatCall,
  presentLspFormatResult,
  presentLspInlayHintsCall,
  presentLspInlayHintsResult,
  presentLspSignatureCall,
  presentLspSignatureResult,
  presentLspSymbolsCall,
  presentLspSymbolsResult,
  symbolKindLabel,
} from '../src/render.ts'

describe('formatDiagnostics', () => {
  it('renders one line per diagnostic with severity labels and code tails', () => {
    const text = formatDiagnostics('a.ts', [
      { severity: 1, range: { start: { line: 0, character: 2 } }, message: 'boom', source: 'ts', code: 2304 },
      { severity: 4, range: { start: { line: 2, character: 0 } }, message: 'hint' },
    ], 16_000)
    expect(text).toBe('a.ts:1:3  [Error] boom [ts 2304]\na.ts:3:1  [Hint] hint')
  })

  it('renders a no-result line for an empty list', () => {
    expect(formatDiagnostics('a.ts', [], 16_000)).toBe('No diagnostics reported for a.ts.')
  })
})

describe('formatCompletionList', () => {
  it('marks the list as reference-only and numbers the items', () => {
    const text = formatCompletionList('a.ts', 3, 2, [{ label: 'alpha', detail: 'fixture alpha' }, { label: 'beta' }], 16_000)
    expect(text).toContain('Completion suggestions for a.ts:3:2 (reference only — nothing was executed; apply one yourself with write/edit).')
    expect(text).toContain('1. alpha — fixture alpha')
    expect(text).toContain('2. beta')
  })

  it('renders the insertion text on an indented arrow line when it adds information', () => {
    const text = formatCompletionList('a.ts', 1, 1, [
      { label: 'log', textEdit: { newText: 'console.log(${1:value})' } },
      { label: 'beta', insertText: 'beta()' },
      { label: 'same', insertText: 'same' },
    ], 16_000)
    expect(text).toContain('1. log\n   → console.log(${1:value})')
    expect(text).toContain('2. beta\n   → beta()')
    // An insertion text identical to the label adds no arrow line.
    expect(text).toContain('3. same')
    expect(text).not.toContain('→ same')
  })

  it('renders a no-completion line', () => {
    const text = formatCompletionList('a.ts', 1, 1, [], 16_000)
    expect(text).toContain('No completions available.')
  })
})

describe('formatAppliedEdits', () => {
  it('summarizes the applied edit count', () => {
    expect(formatAppliedEdits('a.ts', 1)).toContain('applied 1 edit')
    expect(formatAppliedEdits('a.ts', 3)).toContain('applied 3 edits')
  })

  it('names the one-based line span when provided', () => {
    expect(formatAppliedEdits('a.ts', 2, 1)).toContain('applied 2 edits across 1 line')
    expect(formatAppliedEdits('a.ts', 2, 5)).toContain('applied 2 edits across 5 lines')
  })
})

describe('presenters', () => {
  it('presents the diagnostics call as a search card on the file', () => {
    expect(presentLspDiagnosticsCall({ file_path: 'a.ts' })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'LSP diagnostics a.ts',
      locations: [{ path: 'a.ts' }],
    })
  })

  it('presents the diagnostics result from the persisted projection', () => {
    const result = {
      isError: false,
      meta: { diagnostics: [{ line: 4, severity: 1, message: 'boom', source: 'ts', code: 2304 }] },
    } as unknown as ToolResult
    const view = presentLspDiagnosticsResult({ file_path: 'a.ts' }, result)
    expect(view?.card).toBe('generic')
    expect(view?.title).toBe('1 diagnostic in a.ts')
    const content = (view as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(content).toContain('a.ts:4  [Error] boom [ts 2304]')
  })

  it('presents the column when the projection carries it, falling back to line-only for old logs', () => {
    const withColumn = presentLspDiagnosticsResult({ file_path: 'a.ts' }, {
      isError: false,
      meta: { diagnostics: [{ line: 4, character: 2, severity: 2, message: 'careful' }] },
    } as unknown as ToolResult)
    const text = (withColumn as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(text).toContain('a.ts:4:2  [Warning] careful')
    const withoutColumn = presentLspDiagnosticsResult({ file_path: 'a.ts' }, {
      isError: false,
      meta: { diagnostics: [{ line: 4, severity: 2, message: 'careful' }] },
    } as unknown as ToolResult)
    const legacy = (withoutColumn as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(legacy).toContain('a.ts:4  [Warning] careful')
  })

  it('falls back to undefined when the diagnostics projection is missing', () => {
    expect(presentLspDiagnosticsResult({ file_path: 'a.ts' }, { isError: false } as unknown as ToolResult)).toBeUndefined()
  })

  it('presents the completion call at the cursor and the result as reference-only', () => {
    expect(presentLspCompletionCall({ file_path: 'a.ts', line: 3, character: 5 })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'LSP completion a.ts:3:5',
      locations: [{ path: 'a.ts', line: 3 }],
    })
    const result = { isError: false, meta: { items: [{ label: 'alpha', detail: 'd' }, { label: 'beta', insertText: 'beta()' }] } } as unknown as ToolResult
    const view = presentLspCompletionResult({ file_path: 'a.ts', line: 3, character: 5 }, result)
    const content = (view as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(content).toContain('Reference only — nothing was executed.')
    expect(content).toContain('1. alpha — d')
    expect(content).toContain('2. beta')
    expect(content).toContain('   → beta()')
  })

  it('presents the format call as a generic edit card and the result as a diff card', () => {
    expect(presentLspFormatCall({ file_path: 'a.ts' })).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Format a.ts',
      locations: [{ path: 'a.ts' }],
    })
    const result = {
      isError: false,
      meta: { diffs: [{ path: 'a.ts', oldText: 'old\n', newText: 'new\n' }] },
    } as unknown as ToolResult
    const view = presentLspFormatResult({ file_path: 'a.ts' }, result)
    expect(view).toEqual({
      card: 'diff',
      title: 'Format a.ts',
      diffs: [{ path: 'a.ts', oldText: 'old\n', newText: 'new\n' }],
    })
    const unchanged = presentLspFormatResult({ file_path: 'a.ts' }, { isError: false, meta: { diffs: [] } } as unknown as ToolResult)
    expect(unchanged).toEqual({ card: 'diff', title: 'Format a.ts', diffs: [] })
  })
})

describe('extended-tool renderers', () => {
  it('formats code actions with edit lines and command notices', () => {
    const text = formatCodeActions('a.ts', [
      {
        title: 'Fix', kind: 'quickfix', isPreferred: true,
        edits: [{ uri: 'file:///ws/a.ts', edits: [{ range: { start: { line: 1, character: 0 } }, newText: 'fixed' }] }],
        command: { title: 'run', command: 'x.run' },
      },
    ], 16_000)
    expect(text).toContain('1. Fix [quickfix, preferred]')
    expect(text).toContain('file:///ws/a.ts:2:1 → fixed')
    expect(text).toContain('command (reference only, never executed): run')
    expect(formatCodeActions('a.ts', [], 16_000)).toContain('No code actions available.')
  })

  it('formats symbols with kind labels and locations', () => {
    const text = formatSymbols([
      { name: 'sym', kind: 12, location: { uri: 'file:///ws/a.ts', range: { start: { line: 2, character: 1 } } }, containerName: 'mod' },
      { name: 'odd', kind: 99, location: { uri: 'u', range: { start: { line: 0, character: 0 } } } },
    ], 16_000)
    expect(text).toContain('sym [Function] in mod at file:///ws/a.ts:3:2')
    expect(text).toContain('odd [Kind 99]')
    expect(formatSymbols([], 16_000)).toContain('no symbols found')
  })

  it('formats signatures with active markers and parameters', () => {
    const text = formatSignatures('a.ts', [
      { label: 'f(a: number)', parameters: [{ label: 'a: number', documentation: 'first' }], documentation: 'docs' },
      { label: 'g()' },
    ], 0, 0, 16_000)
    expect(text).toContain('▶ 1. f(a: number)')
    expect(text).toContain('▶ a: number — first')
    expect(text).toContain('docs')
    expect(text).toContain(' 2. g()')
    expect(formatSignatures('a.ts', [], undefined, undefined, 16_000)).toContain('No signatures available.')
  })

  it('formats inlay hints with one-based positions and kind tags', () => {
    const text = formatInlayHints('a.ts', [
      { position: { line: 1, character: 0 }, label: ': number', kind: 1 },
      { position: { line: 2, character: 3 }, label: 'p', kind: 2 },
    ], 16_000)
    expect(text).toContain('2:1  : number [type]')
    expect(text).toContain('3:4  p [parameter]')
    expect(formatInlayHints('a.ts', [], 16_000)).toContain('No inlay hints available.')
  })

  it('labels symbol kinds by number with an unknown-kind fallback', () => {
    expect(symbolKindLabel(5)).toBe('Class')
    expect(symbolKindLabel(26)).toBe('TypeParameter')
    expect(symbolKindLabel(99)).toBe('Kind 99')
    expect(symbolKindLabel(0)).toBe('Kind 0')
  })
})

describe('extended-tool presenters', () => {
  const codeActionArgs = { file_path: 'a.ts' }
  const signatureArgs = { file_path: 'a.ts', line: 3, character: 5 }
  const inlayArgs = { file_path: 'a.ts' }

  it('presents the code action call and reference-only result', () => {
    expect(presentLspCodeActionCall(codeActionArgs)).toEqual({
      card: 'generic', kind: 'search', title: 'LSP code actions a.ts', locations: [{ path: 'a.ts' }],
    })
    const result = { isError: false, meta: { items: [{ title: 'Fix', kind: 'quickfix', isPreferred: true }] } } as unknown as ToolResult
    const view = presentLspCodeActionResult(codeActionArgs, result)
    const content = (view as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(content).toContain('1. Fix [quickfix, preferred]')
    const empty = presentLspCodeActionResult(codeActionArgs, { isError: false, meta: { items: [] } } as unknown as ToolResult)
    expect((empty as { title: string }).title).toContain('No code actions')
    expect(presentLspCodeActionResult(codeActionArgs, { isError: false } as unknown as ToolResult)).toBeUndefined()
  })

  it('presents symbol calls and results for query and file modes', () => {
    expect(presentLspSymbolsCall({ query: 'q' })).toEqual({ card: 'generic', kind: 'search', title: 'LSP symbols "q"' })
    expect(presentLspSymbolsCall({ file_path: 'a.ts' })).toEqual({
      card: 'generic', kind: 'search', title: 'LSP symbols a.ts', locations: [{ path: 'a.ts' }],
    })
    const result = { isError: false, meta: { items: [{ name: 'sym', kind: 12, location: { uri: 'file:///ws/a.ts', line: 3, character: 2 } }] } } as unknown as ToolResult
    const view = presentLspSymbolsResult({}, result)
    const content = (view as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(content).toContain('sym [Function] at file:///ws/a.ts:3:2')
    const empty = presentLspSymbolsResult({}, { isError: false, meta: { items: [] } } as unknown as ToolResult)
    expect((empty as { title: string }).title).toContain('No symbols')
    expect(presentLspSymbolsResult({}, { isError: false } as unknown as ToolResult)).toBeUndefined()
  })

  it('presents the signature call and result', () => {
    expect(presentLspSignatureCall(signatureArgs)).toEqual({
      card: 'generic', kind: 'search', title: 'LSP signature a.ts:3:5', locations: [{ path: 'a.ts', line: 3 }],
    })
    const result = { isError: false, meta: { signatures: [{ label: 'f(a)', documentation: 'docs' }] } } as unknown as ToolResult
    const view = presentLspSignatureResult(signatureArgs, result)
    const content = (view as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(content).toContain('1. f(a) — docs')
    const empty = presentLspSignatureResult(signatureArgs, { isError: false, meta: { signatures: [] } } as unknown as ToolResult)
    expect((empty as { title: string }).title).toContain('No signatures')
    expect(presentLspSignatureResult(signatureArgs, { isError: false } as unknown as ToolResult)).toBeUndefined()
  })

  it('presents the inlay hints call and result', () => {
    expect(presentLspInlayHintsCall(inlayArgs)).toEqual({
      card: 'generic', kind: 'search', title: 'LSP inlay hints a.ts', locations: [{ path: 'a.ts' }],
    })
    const result = { isError: false, meta: { items: [{ line: 2, character: 1, label: ': number' }] } } as unknown as ToolResult
    const view = presentLspInlayHintsResult(inlayArgs, result)
    const content = (view as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(content).toContain('2:1  : number')
    const empty = presentLspInlayHintsResult(inlayArgs, { isError: false, meta: { items: [] } } as unknown as ToolResult)
    expect((empty as { title: string }).title).toContain('No inlay hints')
    expect(presentLspInlayHintsResult(inlayArgs, { isError: false } as unknown as ToolResult)).toBeUndefined()
  })
})
