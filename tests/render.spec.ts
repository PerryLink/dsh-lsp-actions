import { describe, expect, it } from 'vitest'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import {
  formatAppliedEdits,
  formatCompletionList,
  formatDiagnostics,
  presentLspCompletionCall,
  presentLspCompletionResult,
  presentLspDiagnosticsCall,
  presentLspDiagnosticsResult,
  presentLspFormatCall,
  presentLspFormatResult,
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
    const result = { isError: false, meta: { items: [{ label: 'alpha', detail: 'd' }] } } as unknown as ToolResult
    const view = presentLspCompletionResult({ file_path: 'a.ts', line: 3, character: 5 }, result)
    const content = (view as { content?: Array<{ text: string }> }).content?.[0]?.text ?? ''
    expect(content).toContain('Reference only — nothing was executed.')
    expect(content).toContain('1. alpha — d')
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
