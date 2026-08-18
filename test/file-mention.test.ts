import { describe, it, expect } from 'vitest'
import { mentionQuery, matchFileCandidates, FILE_MENTION_MAX_MATCHES } from '../src/render/file-mention.ts'

describe('mentionQuery', () => {
  it('detects a mention at the start of the line', () => {
    expect(mentionQuery('@foo', 4)).toEqual({ isMentionMode: true, query: 'foo', start: 0 })
  })

  it('detects a mention mid-sentence, preceded by whitespace', () => {
    expect(mentionQuery('look at @src/inde', 17)).toEqual({ isMentionMode: true, query: 'src/inde', start: 8 })
  })

  it('is not a mention when the @ is not preceded by whitespace or start-of-line', () => {
    expect(mentionQuery('foo@bar', 7).isMentionMode).toBe(false)
  })

  it('is not a mention when the cursor is not inside a token', () => {
    expect(mentionQuery('hello world', 5).isMentionMode).toBe(false)
  })

  it('is not a mention once the token has no @ at all', () => {
    expect(mentionQuery('plain text', 5).isMentionMode).toBe(false)
  })

  it('an empty query right after @ is still mention mode', () => {
    expect(mentionQuery('@', 1)).toEqual({ isMentionMode: true, query: '', start: 0 })
  })

  it('closes once a space ends the token', () => {
    expect(mentionQuery('@foo ', 5).isMentionMode).toBe(false)
  })
})

describe('matchFileCandidates', () => {
  const candidates = ['src/index.ts', 'src/render/app.tsx', 'src/render/input-bar.tsx', 'docs/README.md', 'test/app.test.ts']

  it('filters by case-insensitive substring', () => {
    expect(matchFileCandidates(candidates, 'INPUT')).toEqual(['src/render/input-bar.tsx'])
  })

  it('ranks a path-prefix match above a basename-prefix match', () => {
    const result = matchFileCandidates(candidates, 'src')
    expect(result[0]).toBe('src/index.ts')
  })

  it('ranks a basename-prefix match above a plain substring match', () => {
    const result = matchFileCandidates(['a/zzz-app.ts', 'app/index.ts'], 'app')
    // "app/index.ts" is a path-prefix match; "a/zzz-app.ts" only matches inside its basename.
    expect(result).toEqual(['app/index.ts', 'a/zzz-app.ts'])
  })

  it('breaks ties within the same rank by shorter path first', () => {
    const result = matchFileCandidates(['src/index.ts', 'src/index.test.ts'], 'src/index')
    expect(result).toEqual(['src/index.ts', 'src/index.test.ts'])
  })

  it('caps results at the given limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => `file${i}.ts`)
    expect(matchFileCandidates(many, 'file')).toHaveLength(FILE_MENTION_MAX_MATCHES)
  })

  it('respects a custom limit', () => {
    expect(matchFileCandidates(candidates, '', 2)).toHaveLength(2)
  })

  it('an empty query matches everything', () => {
    expect(matchFileCandidates(candidates, '').length).toBe(candidates.length)
  })
})
