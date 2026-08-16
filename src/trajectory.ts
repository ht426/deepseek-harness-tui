/**
 * Trajectory fold: session events → a turn-aware event ledger.
 *
 * Distinct from the transcript fold: this one keeps the raw tool arguments and
 * per-record timing, grouped by turn/step, for the interactive trajectory view
 * (the terminal equivalent of the Web `ui-trajectory` ledger). Pure and
 * presenter-injected, so it is unit-testable without a live harness.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'
// Trigger the SessionEventMap merge so command/run and command/done narrow.
import type {} from '@deepseek-ai/dsh-commands'

/** One ledger record. */
export type TrajectoryRecord =
  | {
      kind: 'user'; seq: number; time: number; text: string
      turn?: number; step?: number
    }
  | {
      kind: 'assistant'; seq: number; time: number; text: string; reasoning?: string
      usage?: TokenUsage; durationMs?: number
      turn: number; step: number
    }
  | {
      kind: 'tool'; seq: number; time: number; callId: string; name: string; argsJson: string
      status: 'running' | 'done'; outputText?: string; exitCode?: number; signal?: string; error?: boolean
      durationMs?: number; turn: number; step: number
    }
  | { kind: 'command'; seq: number; time: number; name: string; args?: string; status: 'running' | 'done' | 'error'; text?: string; turn?: number }
  | { kind: 'todo'; seq: number; time: number; todos: TodoItem[]; turn?: number }
  | { kind: 'context'; seq: number; time: number; text: string; turn?: number; step?: number }

/** One turn: its records in seq order plus boundary times. */
export interface TrajectoryTurn {
  turn: number
  startTime: number
  endTime: number | undefined
  records: TrajectoryRecord[]
}

/** The full folded ledger. */
export interface Trajectory {
  turns: TrajectoryTurn[]
  /** Records that landed outside a turn (standalone commands, todos). */
  betweenTurns: TrajectoryRecord[]
}

/** Join the text blocks of a content array. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  let out = ''
  for (const block of content) {
    if (block.type === 'text' && block.text !== undefined) out += block.text
  }
  return out
}

function reasoningOf(content: readonly { type: string; text?: string }[]): string | undefined {
  for (const block of content) {
    if (block.type === 'reasoning' && block.text !== undefined) return block.text
  }
  return undefined
}

/**
 * Incremental trajectory ledger. Consumes one {@link SessionEvent} at a time;
 * maintains turn/step grouping, tool call/result pairing, and per-record
 * timing.
 */
export class TrajectoryFold {
  private readonly turns: TrajectoryTurn[] = []
  private readonly betweenTurns: TrajectoryRecord[] = []
  private readonly turnIndex = new Map<number, TrajectoryTurn>()
  /** callId → record, so a tool/result can complete its running row. */
  private readonly toolIndex = new Map<string, Extract<TrajectoryRecord, { kind: 'tool' }>>()
  /** callId → { turn, step }, remembered for result-time grouping. */
  private readonly toolMeta = new Map<string, { turn: number; step: number }>()

  /** The folded ledger snapshot. */
  get value(): Trajectory {
    return { turns: [...this.turns], betweenTurns: [...this.betweenTurns] }
  }

  /** Fold one event. */
  push(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.openTurn(event.data.turn, event.time)
        break
      case 'turn/end':
        this.closeTurn(event.data.turn, event.time)
        break
      case 'user/message': {
        const turn = this.currentTurn()
        const text = textOf(event.data.content)
        if (event.data.source.kind === 'user') {
          this.append({ kind: 'user', seq: event.seq, time: event.time, text, ...(turn === undefined ? {} : { turn: turn.turn }) })
        } else {
          this.append({ kind: 'context', seq: event.seq, time: event.time, text, ...(turn === undefined ? {} : { turn: turn.turn }) })
        }
        break
      }
      case 'assistant/chunk': {
        // Streamed deltas are folded into the assembled message; chunks alone
        // carry no ledger row (they would duplicate the final text).
        break
      }
      case 'assistant/message': {
        const turn = event.data.turn
        const step = event.data.step
        const stepStart = this.stepStartTime(turn, step)
        const durationMs = stepStart === undefined ? undefined : event.time - stepStart
        this.append({
          kind: 'assistant', seq: event.seq, time: event.time,
          text: textOf(event.data.message.content),
          reasoning: reasoningOf(event.data.message.content),
          usage: event.data.usage, durationMs, turn, step,
        })
        break
      }
      case 'tool/call': {
        const turn = event.data.turn
        const step = event.data.step
        const record: Extract<TrajectoryRecord, { kind: 'tool' }> = {
          kind: 'tool', seq: event.seq, time: event.time, callId: event.data.callId,
          name: event.data.name, argsJson: event.data.arguments, status: 'running', turn, step,
        }
        this.toolIndex.set(event.data.callId, record)
        this.toolMeta.set(event.data.callId, { turn, step })
        this.append(record)
        break
      }
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const record = this.toolIndex.get(callId)
        const resultBlock = event.data.message.content[0]
        const outputText = resultBlock !== undefined && resultBlock.type === 'tool-result'
          ? textOf(resultBlock.content)
          : ''
        if (record !== undefined) {
          record.status = 'done'
          record.outputText = outputText
          record.error = event.data.error !== undefined
          record.durationMs = event.time - record.time
        }
        // A result whose call was never projected still appears.
        break
      }
      case 'command/run':
        this.append({ kind: 'command', seq: event.seq, time: event.time, name: event.data.name, args: event.data.args, status: 'running' })
        break
      case 'command/done': {
        const last = this.lastRecord()
        if (last !== undefined && last.kind === 'command' && last.status === 'running') {
          last.status = event.data.kind === 'success' ? 'done' : 'error'
          last.text = event.data.text
        } else {
          this.append({ kind: 'command', seq: event.seq, time: event.time, name: 'command', status: event.data.kind === 'success' ? 'done' : 'error', text: event.data.text })
        }
        break
      }
      case 'todo/write':
        this.append({ kind: 'todo', seq: event.seq, time: event.time, todos: event.data.todos })
        break
      default:
        break
    }
  }

  private openTurn(turn: number, time: number): void {
    if (this.turnIndex.has(turn)) return
    const entry: TrajectoryTurn = { turn, startTime: time, endTime: undefined, records: [] }
    this.turns.push(entry)
    this.turnIndex.set(turn, entry)
  }

  private closeTurn(turn: number, time: number): void {
    const entry = this.turnIndex.get(turn)
    if (entry !== undefined) entry.endTime = time
  }

  private currentTurn(): TrajectoryTurn | undefined {
    const open = [...this.turnIndex.values()].find(t => t.endTime === undefined)
    return open ?? this.turns.at(-1)
  }

  /** Resolve a step's start time from the turn's first assistant/tool record. */
  private stepStartTime(turn: number, step: number): number | undefined {
    const entry = this.turnIndex.get(turn)
    if (entry === undefined) return undefined
    for (const record of entry.records) {
      if ((record.kind === 'assistant' || record.kind === 'tool') && record.turn === turn && record.step === step) {
        return record.time
      }
    }
    return undefined
  }

  private lastRecord(): TrajectoryRecord | undefined {
    const open = this.currentTurn()
    if (open !== undefined && open.records.length > 0) return open.records.at(-1)
    return this.betweenTurns.at(-1)
  }

  private append(record: TrajectoryRecord): void {
    const turn = this.currentTurn()
    if (turn !== undefined) {
      turn.records.push(record)
    } else {
      this.betweenTurns.push(record)
    }
  }
}

/** Fold a full log once (resume/replay). */
export function foldTrajectory(events: readonly SessionEvent[]): Trajectory {
  const fold = new TrajectoryFold()
  for (const event of events) fold.push(event)
  return fold.value
}
