import { describe, it, expect } from 'vitest'
import { parseApiKey, parseAddProvider, splitModelArg } from '../src/command-args.ts'

describe('parseApiKey', () => {
  it('parses an env var and key', () => {
    expect(parseApiKey('OPENAI_API_KEY sk-abc123')).toEqual({ ok: true, ref: 'OPENAI_API_KEY', value: 'sk-abc123' })
  })

  it('rejects missing key', () => {
    const r = parseApiKey('OPENAI_API_KEY')
    expect(r.ok).toBe(false)
  })

  it('rejects empty input', () => {
    expect(parseApiKey('').ok).toBe(false)
  })

  it('preserves a key containing spaces', () => {
    const r = parseApiKey('ACME_KEY sk part two')
    expect(r).toEqual({ ok: true, ref: 'ACME_KEY', value: 'sk part two' })
  })
})

describe('parseAddProvider', () => {
  it('parses route, baseURL, env var, and comma-separated models', () => {
    const r = parseAddProvider('acme https://acme.example/v1 ACME_API_KEY acme-large,acme-think')
    expect(r).toEqual({
      ok: true,
      route: 'acme',
      baseURL: 'https://acme.example/v1',
      apiKeyEnv: 'ACME_API_KEY',
      models: ['acme-large', 'acme-think'],
    })
  })

  it('trims model ids and drops empties', () => {
    const r = parseAddProvider('acme https://x ACME_API_KEY a, b ,,c,')
    expect(r.ok && r.models).toEqual(['a', 'b', 'c'])
  })

  it('rejects missing fields', () => {
    expect(parseAddProvider('').ok).toBe(false)
    expect(parseAddProvider('acme').ok).toBe(false)
    expect(parseAddProvider('acme https://x').ok).toBe(false)
    expect(parseAddProvider('acme https://x ACME_KEY').ok).toBe(false)
  })

  it('rejects an empty model list', () => {
    expect(parseAddProvider('acme https://x ACME_KEY ,,,').ok).toBe(false)
  })
})

describe('splitModelArg', () => {
  it('splits provider/model', () => {
    expect(splitModelArg('openai/gpt-4o', 'deepseek-official')).toEqual({ provider: 'openai', model: 'gpt-4o' })
  })

  it('falls back to the current provider for a bare model id', () => {
    expect(splitModelArg('deepseek-v4-pro', 'deepseek-official')).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  })
})
