import { describe, expect, it } from 'vitest'
import { applyEdits } from '../src/edits.ts'

const position = (line: number, character: number) => ({ line, character })
const range = (start: [number, number], end: [number, number]) => ({ start: position(...start), end: position(...end) })

describe('applyEdits', () => {
  it('applies non-overlapping edits in any order', () => {
    const text = 'alpha\nbeta\ngamma\n'
    const edits = [
      { range: range([1, 0], [1, 4]), newText: 'B' },
      { range: range([0, 0], [0, 5]), newText: 'A' },
    ]
    expect(applyEdits(text, edits)).toBe('A\nB\ngamma\n')
  })

  it('supports insertions at line ends and empty newText deletions', () => {
    const text = 'ab\ncd\n'
    const edits = [
      { range: range([0, 2], [0, 2]), newText: '!' },
      { range: range([1, 0], [1, 2]), newText: '' },
    ]
    expect(applyEdits(text, edits)).toBe('ab!\n\n')
  })

  it('counts characters as UTF-16 code units inside the line', () => {
    const text = 'éé\n'
    const edits = [{ range: range([0, 1], [0, 2]), newText: 'x' }]
    expect(applyEdits(text, edits)).toBe('éx\n')
  })

  it('rejects overlapping edits as a conflict', () => {
    const text = 'hello\n'
    const edits = [
      { range: range([0, 0], [0, 3]), newText: 'A' },
      { range: range([0, 2], [0, 4]), newText: 'B' },
    ]
    expect(() => applyEdits(text, edits)).toThrow(expect.objectContaining({ code: 'LSP_ACTION_CONFLICT' }))
  })

  it.each([
    ['a start past the last line', range([4, 0], [4, 1])],
    ['a character past the line end', range([0, 99], [0, 99])],
    ['a negative line', range([-1, 0], [-1, 1])],
  ])('rejects %s as an out-of-bounds conflict', (_label, editRange) => {
    const text = 'ab\ncd\n'
    expect(() => applyEdits(text, [{ range: editRange, newText: 'x' }])).toThrow(expect.objectContaining({ code: 'LSP_ACTION_CONFLICT' }))
  })

  it('returns the text unchanged when there are no edits', () => {
    expect(applyEdits('abc', [])).toBe('abc')
  })
})
