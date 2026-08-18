/**
 * Observable UI store bridging the Cordis host seams to the ink React tree.
 *
 * The host plugin writes events, questions, approvals, model selection, and
 * status here; the ink components subscribe with `useSyncExternalStore`. The
 * store owns no Cordis context — it is a plain, unit-testable state machine
 * so the render layer can be tested against synthetic inputs.
 */

import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Transcript } from './transcript.ts'
import type { TranscriptNode, ToolPresenter } from './transcript.ts'
import { TrajectoryFold } from './trajectory.ts'
import type { Trajectory, TrajectoryRecord } from './trajectory.ts'
import type { SessionStats, TokenUsage, ContextPressure } from './statsFormat.ts'

export type { TranscriptNode, ToolPresenter } from './transcript.ts'
export type { Trajectory, TrajectoryRecord, TrajectoryTurn } from './trajectory.ts'

/** A pending user question waiting on a modal answer. */
export interface PendingQuestion {
  request: AskUserQuestionRequest
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: unknown) => void
}

/** A pending approval waiting on a modal answer. */
export interface PendingApproval {
  toolName: string
  reason?: string
  resolve: (outcome: ApprovalOutcome) => void
}

/** One option in a command select menu. */
export interface SelectOption {
  value: string
  label: string
  description?: string
}

/** A pending command select menu (slash-command option picker). */
export interface PendingSelect {
  title: string
  options: readonly SelectOption[]
  currentValue?: string
  resolve: (value: string | undefined) => void
}

/** Which modal owns the terminal focus right now. */
export type Modal =
  | { kind: 'question'; question: PendingQuestion }
  | { kind: 'approval'; approval: PendingApproval }
  | { kind: 'select'; select: PendingSelect }

/** Which top-level view the app renders. */
export type TuiView = 'chat' | 'trajectory'

/** Trajectory view state: cursor + expansion + timeline toggle. */
export interface TrajectoryState {
  /** Flat record cursor index into the combined turn/step ledger. */
  cursor: number
  /** seqs of records whose detail is expanded. */
  expanded: readonly number[]
  /** Whether the ASCII overview timeline is shown above the ledger. */
  showTimeline: boolean
}

/** Whole-log projections backing the status bar's stats/context lines. */
export interface TuiStats {
  sessionStats: SessionStats | undefined
  tokenUsage: TokenUsage | undefined
  contextPressure: ContextPressure | undefined
}

/** The `@`-mention dropdown's backing file list: not yet requested, loading, or settled. */
export interface FileIndexState {
  candidates: readonly string[] | undefined
  loading: boolean
}

/** Immutable UI snapshot; a new object is minted on every state change. */
export interface TuiSnapshot {
  status: 'booting' | 'idle' | 'running'
  model: ModelSelection | undefined
  sessionId: string | undefined
  nodes: readonly TranscriptNode[]
  trajectory: Trajectory
  view: TuiView
  traj: TrajectoryState
  todos: readonly { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  modal: Modal | undefined
  sessions: readonly SessionRecord[]
  notice: string | undefined
  noticeLevel: 'info' | 'error'
  stats: TuiStats
  fileIndex: FileIndexState
}

const EMPTY_STATS: TuiStats = { sessionStats: undefined, tokenUsage: undefined, contextPressure: undefined }
const EMPTY_FILE_INDEX: FileIndexState = { candidates: undefined, loading: false }

const EMPTY: TuiSnapshot = {
  status: 'booting',
  model: undefined,
  sessionId: undefined,
  nodes: [],
  trajectory: { turns: [], betweenTurns: [] },
  view: 'chat',
  traj: { cursor: 0, expanded: [], showTimeline: true },
  todos: [],
  modal: undefined,
  sessions: [],
  notice: undefined,
  noticeLevel: 'info',
  stats: EMPTY_STATS,
  fileIndex: EMPTY_FILE_INDEX,
}

type Listener = () => void

/**
 * Owns the mutable transcript plus modal/status state and exposes immutable
 * snapshots. `subscribe`/`getSnapshot` match `useSyncExternalStore`.
 */
export class TuiStore {
  private snapshot: TuiSnapshot = { ...EMPTY }
  private readonly listeners = new Set<Listener>()
  private transcript: Transcript
  private trajectory: TrajectoryFold

  constructor(presenter?: ToolPresenter) {
    this.transcript = new Transcript(presenter)
    this.trajectory = new TrajectoryFold()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): TuiSnapshot => this.snapshot

  /** Mint and publish the next snapshot, notifying subscribers. */
  private commit(patch: Partial<TuiSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Replace the whole snapshot (used for boot-time setup). */
  set(patch: Partial<TuiSnapshot>): void {
    this.commit(patch)
  }

  /** Fold one session event into the transcript and the trajectory ledger. */
  pushEvent(event: SessionEvent): void {
    this.transcript.push(event)
    this.trajectory.push(event)
    let todos = this.snapshot.todos
    if (event.type === 'todo/write') todos = event.data.todos
    this.commit({ nodes: this.transcript.list.slice(), trajectory: this.trajectory.value, todos })
  }

  /** Replace the tool presenter (the host resolves it once the agent exists). */
  setPresenter(presenter: ToolPresenter): void {
    this.transcript.presenter = presenter
  }

  /** Set the current session id (display only). */
  setSessionId(sessionId: string): void {
    this.commit({ sessionId })
  }

  /** Rebuild both folds from an existing log (resume). */
  replay(events: readonly SessionEvent[]): void {
    const fresh = new Transcript(this.transcript.presenter)
    for (const event of events) fresh.push(event)
    this.transcript = fresh
    const freshTraj = new TrajectoryFold()
    for (const event of events) freshTraj.push(event)
    this.trajectory = freshTraj
    this.commit({ nodes: this.transcript.list.slice(), trajectory: this.trajectory.value })
  }

  /** Begin a modal question and return a promise the UI answers. */
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      this.commit({ modal: { kind: 'question', question: { request, resolve, reject } } })
    })
  }

  /** Begin a modal approval and return a promise the UI answers. */
  approve(toolName: string, reason: string | undefined): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      this.commit({ modal: { kind: 'approval', approval: { toolName, reason, resolve } } })
    })
  }

  /** Answer the active question modal (no-op when none is open). */
  answerQuestion(answer: AskUserQuestionAnswer): void {
    const modal = this.snapshot.modal
    if (modal?.kind !== 'question') return
    const { resolve } = modal.question
    this.commit({ modal: undefined })
    resolve(answer)
  }

  /** Reject the active question modal (no-op when none is open). */
  rejectQuestion(error: unknown): void {
    const modal = this.snapshot.modal
    if (modal?.kind !== 'question') return
    const { reject } = modal.question
    this.commit({ modal: undefined })
    reject(error)
  }

  /** Answer the active approval modal (no-op when none is open). */
  answerApproval(outcome: ApprovalOutcome): void {
    const modal = this.snapshot.modal
    if (modal?.kind !== 'approval') return
    const { resolve } = modal.approval
    this.commit({ modal: undefined })
    resolve(outcome)
  }

  /** Begin a modal command-select menu and return the chosen value. */
  select(title: string, options: readonly SelectOption[], currentValue?: string): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      this.commit({ modal: { kind: 'select', select: { title, options, currentValue, resolve } } })
    })
  }

  /** Answer the active select modal (no-op when none is open). */
  answerSelect(value: string | undefined): void {
    const modal = this.snapshot.modal
    if (modal?.kind !== 'select') return
    const { resolve } = modal.select
    this.commit({ modal: undefined })
    resolve(value)
  }

  setStatus(status: TuiSnapshot['status']): void {
    this.commit({ status })
  }

  setModel(model: ModelSelection | undefined): void {
    this.commit({ model })
  }

  /** Refresh the whole-log stats/context projections backing the status bar. */
  setStats(stats: TuiStats): void {
    this.commit({ stats })
  }

  setSessions(sessions: readonly SessionRecord[]): void {
    this.commit({ sessions })
  }

  setNotice(notice: string | undefined, level: 'info' | 'error' = 'info'): void {
    this.commit({ notice, noticeLevel: level })
  }

  /** Mark the `@`-mention file index as loading; a no-op once candidates are already present. */
  setFileIndexLoading(): void {
    if (this.snapshot.fileIndex.candidates !== undefined) return
    this.commit({ fileIndex: { candidates: undefined, loading: true } })
  }

  /** Settle the `@`-mention file index once `loadFileIndex` resolves. */
  setFileIndex(candidates: readonly string[]): void {
    this.commit({ fileIndex: { candidates, loading: false } })
  }

  // --- Trajectory view state ----------------------------------------------

  /** Switch the top-level view. */
  setView(view: TuiView): void {
    this.commit({ view })
  }

  /** Move the trajectory cursor by a delta, clamped to the ledger bounds. */
  moveCursor(delta: number): void {
    const records = flatRecords(this.snapshot.trajectory)
    const next = clamp(this.snapshot.traj.cursor + delta, 0, Math.max(0, records.length - 1))
    if (next === this.snapshot.traj.cursor) return
    this.commit({ traj: { ...this.snapshot.traj, cursor: next } })
  }

  /** Toggle the detail expansion of one record by seq. */
  toggleExpanded(seq: number): void {
    const { traj } = this.snapshot
    const expanded = traj.expanded.includes(seq)
      ? traj.expanded.filter(s => s !== seq)
      : [...traj.expanded, seq]
    this.commit({ traj: { ...traj, expanded } })
  }

  /** Toggle the ASCII overview timeline. */
  toggleTimeline(): void {
    const { traj } = this.snapshot
    this.commit({ traj: { ...traj, showTimeline: !traj.showTimeline } })
  }
}

/** Flatten the trajectory ledger into one navigable record list. */
export function flatRecords(t: Trajectory): readonly TrajectoryRecord[] {
  const out: TrajectoryRecord[] = [...t.betweenTurns]
  for (const turn of t.turns) out.push(...turn.records)
  return out
}

/** Clamp a number into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
