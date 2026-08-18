import { describe, it, expect } from 'vitest'
import { lineStartIndex, lineEndIndex, backwardWordBoundary, computeRowCol, moveCursorVertically } from '../src/render/line-motion.ts'

describe('lineStartIndex / lineEndIndex', () => {
  it('returns the whole buffer bounds on a single line', () => {
    expect(lineStartIndex('hello', 3)).toBe(0)
    expect(lineEndIndex('hello', 3)).toBe(5)
  })

  it('finds the current line bounds within a multi-line buffer', () => {
    const text = 'foo\nbar baz\nqux'
    // cursor at 'z' in "bar baz" (index 10)
    expect(lineStartIndex(text, 10)).toBe(4)
    expect(lineEndIndex(text, 10)).toBe(11)
  })

  it('at the very start of a line, still resolves to that line own bounds', () => {
    const text = 'foo\nbar'
    expect(lineStartIndex(text, 4)).toBe(4)
    expect(lineEndIndex(text, 4)).toBe(7)
  })
})

describe('backwardWordBoundary', () => {
  it('finds the start of the word behind the cursor', () => {
    expect(backwardWordBoundary('hello world', 11)).toBe(6)
  })

  it('skips trailing whitespace before finding the word', () => {
    expect(backwardWordBoundary('hello   ', 8)).toBe(0)
  })

  it('stops at a newline (whitespace) rather than crossing into the previous line', () => {
    expect(backwardWordBoundary('foo\nbar', 7)).toBe(4)
  })

  it('is a no-op at the start of the buffer', () => {
    expect(backwardWordBoundary('hello', 0)).toBe(0)
  })
})

describe('computeRowCol', () => {
  it('is row 0 on a single-line buffer', () => {
    expect(computeRowCol('hello', 3)).toEqual({ row: 0, col: 3 })
  })

  it('counts newlines to find the row, and offsets from the last one for the column', () => {
    const text = 'foo\nbar\nbaz'
    expect(computeRowCol(text, 9)).toEqual({ row: 2, col: 1 })
  })

  it('is column 0 right after a newline', () => {
    expect(computeRowCol('foo\nbar', 4)).toEqual({ row: 1, col: 0 })
  })
})

describe('moveCursorVertically', () => {
  const text = 'ab\nabcdef\nab'

  it('moves up clamping to the shorter target line length', () => {
    // cursor at col 3 on line 1 ("abcdef")
    expect(moveCursorVertically(text, 6, -1)).toBe(2) // line 0 "ab" only has 2 cols, clamps
  })

  it('moves down clamping to the shorter target line length', () => {
    // cursor at col 5 on line 1 ("abcdef")
    expect(moveCursorVertically(text, 8, 1)).toBe(12) // line 2 "ab" clamps to its own end
  })

  it('is a no-op moving up from the first line', () => {
    expect(moveCursorVertically(text, 1, -1)).toBe(1)
  })

  it('is a no-op moving down from the last line', () => {
    expect(moveCursorVertically(text, 11, 1)).toBe(11)
  })

  it('preserves column exactly when the target line is at least as long', () => {
    const twoLines = 'abcdef\nab'
    // cursor at col 1 on line 0
    expect(moveCursorVertically(twoLines, 1, 1)).toBe(8) // line 1 "ab", col 1 -> offset 7+1
  })
})
