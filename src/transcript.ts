/**
 * Transcript fold: session events → render nodes.
 *
 * Pure and presenter-injected, so it is unit-testable without a live harness.
 * The host supplies the real tool presenter (from `ctx.tools`); tests supply
 * stubs. One fold instance belongs to one session: it owns the running tool,
 * command, and streaming assistant state, matching `callId`/`commandId`/
 * `turn:step` across events.
 */

import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
// Trigger the SessionEventMap merge so command/run and command/done narrow.
import type {} from '@deepseek-ai/dsh-commands'

/** How a completed tool call finished, for the exit-status pill. */
export interface ToolFinish {
  exitCode?: number
  signal?: string
  error?: boolean
}

/** One render node in the folded transcript. */
export type TranscriptNode =
  | { kind: 'user'; key: string; seq: number; time: number; text: string }
  | {
      kind: 'assistant'; key: string; seq: number; time: number; text: string
      reasoning?: string; usage?: TokenUsage
    }
  | {
      kind: 'tool'; key: string; seq: number; time: number; callId: string; name: string
      status: 'running' | 'done'; title?: string; description?: string; cwd?: string
      body?: string; finish?: ToolFinish; durationMs?: number
      callView?: ToolCallView; resultView?: ToolResultView
    }
  | { kind: 'context'; key: string; seq: number; time: number; text: string }
  | { kind: 'todo'; key: string; seq: number; todos: TodoItem[] }
  | { kind: 'command'; key: string; seq: number; name: string; args?: string; status: 'running' | 'done' | 'error'; text?: string }
  | { kind: 'notice'; key: string; seq: number; level: 'info' | 'warn' | 'error'; text: string }

/** Presenter bridge: turns raw tool events into render intents, mirroring the
 *  `ToolDefinition.presentCall` / `presentResult` contract. */
export interface ToolPresenter {
  presentCall(name: string, argsJson: string): ToolCallView | undefined
  presentResult(name: string, argsJson: string, content: ContentBlock[], isError: boolean, meta?: JsonValue): ToolResultView | undefined
}

/** Join the text blocks of a content array into one string. */
function textOf(content: readonly ContentBlock[]): string {
  let out = ''
  for (const block of content) {
    if (block.type === 'text') out += block.text
  }
  return out
}

/** Extract a reasoning block if one is present. */
function reasoningOf(content: readonly ContentBlock[]): string | undefined {
  for (const block of content) {
    if (block.type === 'reasoning') return block.text
  }
  return undefined
}

/** A remembered tool call, so its result can re-derive the presenter intent. */
interface CallMemory {
  name: string
  argsJson: string
}

/**
 * Incremental session transcript. Consumes one {@link SessionEvent} at a time
 * and maintains an ordered node list plus running/streaming pairing state.
 */
export class Transcript {
  presenter: ToolPresenter | undefined
  private readonly nodes: TranscriptNode[] = []
  /** callId → node index, so a `tool/result` completes its running card. */
  private readonly toolIndex = new Map<string, number>()
  /** callId → remembered name/args, for result-time presenter intents. */
  private readonly callMemory = new Map<string, CallMemory>()
  /** commandId → node index (via the command/run seq key). */
  private readonly commandIndex = new Map<string, number>()
  /** turn:step → assistant node index, so streaming chunks extend one node. */
  private readonly streamIndex = new Map<string, number>()

  constructor(presenter?: ToolPresenter) {
    this.presenter = presenter
  }

  /** The folded nodes, newest last. */
  get list(): readonly TranscriptNode[] {
    return this.nodes
  }

  /** Fold one event. */
  push(event: SessionEvent): void {
    switch (event.type) {
      case 'user/message':
        this.pushUser(event)
        break
      case 'assistant/chunk':
        this.pushChunk(event.data.turn, event.data.step, event.data.chunk, event.seq, event.time)
        break
      case 'assistant/message':
        this.pushAssistant(event)
        break
      case 'tool/call':
        this.pushToolCall(event.data.callId, event.data.name, event.data.arguments, event.seq, event.time)
        break
      case 'tool/result':
        this.pushToolResult(event)
        break
      case 'todo/write':
        this.nodes.push({ kind: 'todo', key: `todo:${event.seq}`, seq: event.seq, todos: event.data.todos })
        break
      case 'command/run':
        this.pushCommandRun(event.data.commandId, event.data.name, event.data.args, event.seq)
        break
      case 'command/done':
        this.pushCommandDone(event.data.commandId, event.data.kind, event.data.text, event.seq)
        break
      case 'turn/end':
        this.pushTurnEnd(event.data.turn, event.data.reason, event.seq)
        break
      case 'session/end-seed':
        this.nodes.push({ kind: 'notice', key: `seed:${event.seq}`, seq: event.seq, level: 'info', text: '— earlier history —' })
        break
      default:
        // Unknown/merged event types (approval/asked, agent/inbox/spliced,
        // request/header, …) carry no transcript row.
        break
    }
  }

  private pushUser(event: Extract<SessionEvent, { type: 'user/message' }>): void {
    const text = textOf(event.data.content)
    if (event.data.source.kind !== 'user') {
      this.nodes.push({ kind: 'context', key: `ctx:${event.seq}`, seq: event.seq, time: event.time, text })
    } else {
      this.nodes.push({ kind: 'user', key: `user:${event.seq}`, seq: event.seq, time: event.time, text })
    }
  }

  private pushChunk(turn: number, step: number, chunk: unknown, seq: number, time: number): void {
    const data = chunk as { type: string; text?: string }
    if (data.type !== 'text-delta' && data.type !== 'reasoning-delta') return
    const key = `${turn}:${step}`
    const existing = this.streamIndex.get(key)
    if (existing !== undefined) {
      const node = this.nodes[existing]
      if (node === undefined || node.kind !== 'assistant') return
      if (data.type === 'text-delta') node.text += data.text ?? ''
      else node.reasoning = (node.reasoning ?? '') + (data.text ?? '')
      return
    }
    const node: TranscriptNode = {
      kind: 'assistant', key: `asst:${seq}`, seq, time,
      text: data.type === 'text-delta' ? (data.text ?? '') : '',
      reasoning: data.type === 'reasoning-delta' ? (data.text ?? '') : undefined,
    }
    this.streamIndex.set(key, this.nodes.length)
    this.nodes.push(node)
  }

  private pushAssistant(event: Extract<SessionEvent, { type: 'assistant/message' }>): void {
    const key = `${event.data.turn}:${event.data.step}`
    const text = textOf(event.data.message.content)
    const reasoning = reasoningOf(event.data.message.content)
    const existing = this.streamIndex.get(key)
    if (existing !== undefined) {
      const node = this.nodes[existing]
      if (node !== undefined && node.kind === 'assistant') {
        // Authoritative assembled message replaces streamed partials.
        node.text = text
        node.reasoning = reasoning
        node.usage = event.data.usage
        node.seq = event.seq
        node.time = event.time
        return
      }
    }
    this.nodes.push({
      kind: 'assistant', key: `asst:${event.seq}`, seq: event.seq, time: event.time,
      text, reasoning, usage: event.data.usage,
    })
  }

  private pushToolCall(callId: string, name: string, argsJson: string, seq: number, time: number): void {
    this.callMemory.set(callId, { name, argsJson })
    const view = this.presenter?.presentCall(name, argsJson)
    const node: TranscriptNode = {
      kind: 'tool', key: `tool:${seq}`, seq, time, callId, name, status: 'running',
      callView: view,
      title: view === undefined ? name : view.title,
    }
    if (view !== undefined && view.card === 'terminal') {
      node.description = view.description
      node.cwd = view.cwd
    }
    this.toolIndex.set(callId, this.nodes.length)
    this.nodes.push(node)
  }

  private pushToolResult(event: Extract<SessionEvent, { type: 'tool/result' }>): void {
    const callId = event.data.message.source.callId
    const memory = this.callMemory.get(callId)
    const resultBlock = event.data.message.content[0]
    const content = resultBlock !== undefined && resultBlock.type === 'tool-result' ? resultBlock.content : []
    const isError = resultBlock !== undefined && resultBlock.type === 'tool-result' ? resultBlock.isError === true : false
    const view = memory === undefined
      ? undefined
      : this.presenter?.presentResult(memory.name, memory.argsJson, content, isError, event.data.meta)
    const finish: ToolFinish = { error: event.data.error !== undefined }
    if (view !== undefined && view.card === 'terminal') {
      finish.exitCode = view.exitCode
      finish.signal = view.signal
    }
    const index = this.toolIndex.get(callId)
    if (index !== undefined) {
      const node = this.nodes[index]
      if (node !== undefined && node.kind === 'tool') {
        node.status = 'done'
        node.durationMs = event.time - node.time
        node.seq = event.seq
        node.time = event.time
        node.resultView = view
        node.finish = finish
        node.body = textOf(content)
        return
      }
    }
    this.nodes.push({
      kind: 'tool', key: `tool:${event.seq}`, seq: event.seq, time: event.time,
      callId, name: memory?.name ?? callId, status: 'done', resultView: view, finish,
      body: textOf(content),
    })
  }

  private pushCommandRun(commandId: string, name: string, args: string | undefined, seq: number): void {
    this.commandIndex.set(commandId, this.nodes.length)
    this.nodes.push({ kind: 'command', key: `cmd:${seq}`, seq, name, args, status: 'running' })
  }

  private pushCommandDone(commandId: string, kind: 'success' | 'error', text: string | undefined, seq: number): void {
    const index = this.commandIndex.get(commandId)
    if (index !== undefined) {
      const node = this.nodes[index]
      if (node !== undefined && node.kind === 'command') {
        node.status = kind === 'success' ? 'done' : 'error'
        node.text = text
        return
      }
    }
    this.nodes.push({ kind: 'command', key: `cmd:${seq}`, seq, name: 'command', status: kind === 'success' ? 'done' : 'error', text })
  }

  private pushTurnEnd(turn: number, reason: unknown, seq: number): void {
    const r = reason as { kind: string }
    if (r.kind === 'completed') return
    const label = r.kind === 'error' ? `turn ${turn} failed` : `turn ${turn} ended: ${r.kind}`
    this.nodes.push({
      kind: 'notice', key: `turnend:${seq}`, seq, level: r.kind === 'error' ? 'error' : 'warn', text: label,
    })
  }
}
