import { describe, it, expect } from 'vitest'
import { parseTuiArgs } from '../src/cmdline.ts'
import { markdownToText } from '../src/markdown-text.ts'
import { detectScheme } from '../src/theme.ts'
import { TuiStore } from '../src/store.ts'

describe('parseTuiArgs', () => {
  it('parses resume, model, no-banner, and help', () => {
    expect(parseTuiArgs([])).toEqual({ resumeId: undefined, model: undefined, noBanner: false, help: false })
    expect(parseTuiArgs(['--resume', 'abc'])).toMatchObject({ resumeId: 'abc' })
    expect(parseTuiArgs(['--model', 'deepseek-chat'])).toMatchObject({ model: 'deepseek-chat' })
    expect(parseTuiArgs(['--no-banner'])).toMatchObject({ noBanner: true })
    expect(parseTuiArgs(['-h'])).toMatchObject({ help: true })
    expect(parseTuiArgs(['--help'])).toMatchObject({ help: true })
  })
})

describe('markdownToText', () => {
  it('strips markdown to plain lines', () => {
    const text = markdownToText('# Title\n\nSome **bold** text and `code`.\n\n- one\n- two')
    expect(text).toContain('Title')
    expect(text).toContain('bold')
    expect(text).toContain('one')
  })
})

describe('detectScheme', () => {
  it('defaults to dark', () => {
    expect(detectScheme()).toBe('dark')
  })
})

describe('TuiStore', () => {
  it('answers a question modal and resolves the promise', async () => {
    const store = new TuiStore()
    const pending = store.ask({ questions: [{ id: 'q1', question: 'Proceed?', options: [{ label: 'Yes' }] }] })
    expect(store.getSnapshot().modal?.kind).toBe('question')
    store.answerQuestion({ answers: [{ id: 'q1', selected: ['Yes'] }] })
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Yes'] }] })
    expect(store.getSnapshot().modal).toBeUndefined()
  })

  it('answers an approval modal and resolves the promise', async () => {
    const store = new TuiStore()
    const pending = store.approve('bash', 'unsafe')
    expect(store.getSnapshot().modal?.kind).toBe('approval')
    store.answerApproval('allowed-once')
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('rejects a question modal', async () => {
    const store = new TuiStore()
    const pending = store.ask({ questions: [{ id: 'q1', question: 'x' }] })
    store.rejectQuestion(new Error('aborted'))
    await expect(pending).rejects.toThrow('aborted')
  })

  it('switches views and clamps the trajectory cursor', () => {
    const store = new TuiStore()
    expect(store.getSnapshot().view).toBe('chat')
    store.setView('trajectory')
    expect(store.getSnapshot().view).toBe('trajectory')
    // Empty ledger: cursor stays 0.
    store.moveCursor(1)
    expect(store.getSnapshot().traj.cursor).toBe(0)
    store.moveCursor(-1)
    expect(store.getSnapshot().traj.cursor).toBe(0)
  })

  it('toggles record expansion and the timeline', () => {
    const store = new TuiStore()
    expect(store.getSnapshot().traj.showTimeline).toBe(true)
    store.toggleTimeline()
    expect(store.getSnapshot().traj.showTimeline).toBe(false)
    store.toggleExpanded(7)
    expect(store.getSnapshot().traj.expanded).toContain(7)
    store.toggleExpanded(7)
    expect(store.getSnapshot().traj.expanded).not.toContain(7)
  })

  it('folds events into the trajectory ledger alongside the transcript', () => {
    const store = new TuiStore()
    const ev = { type: 'todo/write', seq: 0, time: 0, data: { todos: [{ content: 'x', status: 'pending' }] } } as never
    store.pushEvent(ev)
    expect(store.getSnapshot().nodes).toHaveLength(1)
    expect(store.getSnapshot().trajectory.betweenTurns).toHaveLength(1)
  })

  it('tracks the @-mention file index through loading to settled', () => {
    const store = new TuiStore()
    expect(store.getSnapshot().fileIndex).toEqual({ candidates: undefined, loading: false })
    store.setFileIndexLoading()
    expect(store.getSnapshot().fileIndex).toEqual({ candidates: undefined, loading: true })
    store.setFileIndex(['a.ts', 'b.ts'])
    expect(store.getSnapshot().fileIndex).toEqual({ candidates: ['a.ts', 'b.ts'], loading: false })
  })

  it('does not reset an already-settled file index back to loading', () => {
    const store = new TuiStore()
    store.setFileIndex(['a.ts'])
    store.setFileIndexLoading()
    expect(store.getSnapshot().fileIndex).toEqual({ candidates: ['a.ts'], loading: false })
  })
})
