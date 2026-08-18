/**
 * Input bar: the `>` prompt. A slash-leading line dispatches as a command;
 * anything else is a free-text prompt. A `@`-mention typed anywhere in a
 * free-text line (mid-sentence, not just at the start) opens a file-picker
 * dropdown backed by the host's lazily-loaded repo file index.
 *
 * Custom input (not ink-text-input) so modifier chords (Ctrl+O, Ctrl+T, Esc)
 * can be consumed here instead of leaking into the input value. The App owns
 * the global chords; this component handles only printable text, backspace,
 * and Enter.
 */

import { Box, Text } from 'ink'
import { useInput } from 'ink'
import { useEffect, useState } from 'react'
import type { TuiController } from '../controller.ts'
import type { FileIndexState } from '../store.ts'
import { mentionQuery, matchFileCandidates } from './file-mention.ts'
import { lineStartIndex, lineEndIndex, backwardWordBoundary, computeRowCol, moveCursorVertically } from './line-motion.ts'

export interface InputBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (line: string) => void
  controller: TuiController
  fileIndex: FileIndexState
}

/** Whether a line is a slash command. */
export function isCommandLine(line: string): boolean {
  return line.startsWith('/')
}

/** Whether the input is mid-typing a slash command (no whitespace yet) and, if so, its query text. */
function commandQuery(value: string): { isCommandMode: boolean; query: string } {
  const query = value.slice(1)
  // Any whitespace (not just a literal space) ends command mode -- a
  // multi-line draft is never mistaken for one just because it starts with
  // "/" and hasn't hit a space character yet.
  const isCommandMode = value.startsWith('/') && !/\s/.test(query)
  return { isCommandMode, query: isCommandMode ? query : '' }
}

type Command = ReturnType<TuiController['listCommands']>[number]

/** Slash commands whose name starts with `query`, prefix-filtered as the user types. */
function matchSlashCommands(commands: readonly Command[], query: string): Command[] {
  return commands.filter(c => c.name.startsWith(query))
}

/**
 * Renders one visual line, with the character at `cursorCol` inverted as a
 * visible block cursor -- or plain text when `cursorCol` is `null`, for
 * every line except the one the cursor is actually on.
 */
function renderLineContent(line: string, cursorCol: number | null): React.ReactNode {
  if (cursorCol === null) return <Text>{line.length > 0 ? line : ' '}</Text>
  const before = line.slice(0, cursorCol)
  const atCursor = line[cursorCol] ?? ' '
  const after = line.slice(cursorCol + 1)
  return (
    <Text>
      {before}
      <Text inverse>{atCursor}</Text>
      {after}
    </Text>
  )
}

export function InputBar({ value, onChange, onSubmit, controller, fileIndex }: InputBarProps): React.ReactNode {
  const [cursor, setCursor] = useState(value.length)
  const [selected, setSelected] = useState(0)
  const [mentionSelected, setMentionSelected] = useState(0)
  // Esc dismisses the dropdown for the current `@…` token without touching
  // the buffer; typing further (changing the query) reopens it — reset
  // alongside `selected`/`mentionSelected` in the text-change branches below,
  // not via a useEffect keyed on the derived query: the real CLI can deliver
  // several keystrokes in one batch before a render happens in between, and
  // an effect firing on a later, unrelated render can silently stomp a
  // selection (or a dismissal) that already applied correctly this tick.
  const [mentionDismissed, setMentionDismissed] = useState(false)

  const commands = controller.listCommands()
  const { isCommandMode, query } = commandQuery(value)
  const matches = isCommandMode ? matchSlashCommands(commands, query) : []
  // Defensive clamp: an arrow-key press processed in the same input batch as a
  // still-pending text change can compute `selected` against a stale, wider
  // match list. Clamping at render time keeps the highlight in range instead
  // of pointing past the end of the freshly-filtered list.
  const selectedInRange = matches.length === 0 ? 0 : Math.min(selected, matches.length - 1)

  // `@`-mention mode never overlaps command mode: isCommandMode requires the
  // whole value to have no whitespace, so a later `@` only opens once a space
  // has ended the slash command (or there was never a leading `/` at all).
  const mention = isCommandMode ? { isMentionMode: false, query: '', start: -1 } : mentionQuery(value, cursor)
  const mentionOpen = mention.isMentionMode && !mentionDismissed
  const mentionMatches = mentionOpen ? matchFileCandidates(fileIndex.candidates ?? [], mention.query) : []
  const mentionSelectedInRange = mentionMatches.length === 0 ? 0 : Math.min(mentionSelected, mentionMatches.length - 1)

  useEffect(() => {
    if (mention.isMentionMode) controller.ensureFileIndex()
  }, [mention.isMentionMode, controller])

  useInput((input, key) => {
    const tabTarget = matches[selectedInRange]
    const completeToTarget = (target: Command): void => {
      const completed = '/' + target.name + ' '
      onChange(completed)
      setCursor(completed.length)
      setSelected(0)
    }
    const mentionTarget = mentionMatches[mentionSelectedInRange]
    const completeMention = (path: string): void => {
      // Splices just the query span (after the `@`), preserving any text
      // before the `@` and after the query — a mention can open mid-sentence,
      // unlike the slash-command dropdown which only ever spans the whole line.
      const before = value.slice(0, mention.start + 1)
      const after = value.slice(mention.start + 1 + mention.query.length)
      const inserted = path + ' '
      const next = before + inserted + after
      onChange(next)
      setCursor((before + inserted).length)
      setMentionSelected(0)
      setMentionDismissed(false)
    }

    // Readline-style line editing, owned here (not the blanket ctrl/meta bail
    // below) since these specific chords are this component's own, not the
    // App's global ones (Ctrl+O/Ctrl+T).
    if (key.ctrl && input === 'w') {
      const start = backwardWordBoundary(value, cursor)
      onChange(value.slice(0, start) + value.slice(cursor))
      setCursor(start)
      return
    }
    if (key.ctrl && input === 'k') {
      onChange(value.slice(0, cursor) + value.slice(lineEndIndex(value, cursor)))
      return
    }
    if (key.ctrl && input === 'u') {
      const start = lineStartIndex(value, cursor)
      onChange(value.slice(0, start) + value.slice(cursor))
      setCursor(start)
      return
    }
    if (key.home || (key.ctrl && input === 'a')) {
      setCursor(lineStartIndex(value, cursor))
      return
    }
    if (key.end || (key.ctrl && input === 'e')) {
      setCursor(lineEndIndex(value, cursor))
      return
    }
    // Remaining ctrl/meta chords belong to the App -- except Meta+Return,
    // which this component owns too (newline insertion, handled below in
    // the key.return block alongside Shift+Return and the backslash
    // fallback). Bailing here unconditionally on `key.meta` would swallow
    // it before that block ever runs, since key.meta is set on the whole
    // keypress, not specifically "meta but not Return".
    if ((key.ctrl || key.meta) && !key.return) return
    if (mentionOpen) {
      if (key.escape) {
        setMentionDismissed(true)
        return
      }
      if (mentionTarget !== undefined) {
        if (key.upArrow) {
          setMentionSelected((mentionSelectedInRange - 1 + mentionMatches.length) % mentionMatches.length)
          return
        }
        if (key.downArrow) {
          setMentionSelected((mentionSelectedInRange + 1) % mentionMatches.length)
          return
        }
        if (key.tab || key.return) {
          completeMention(mentionTarget)
          return
        }
      }
    }
    if (matches.length > 0 && key.upArrow) {
      setSelected(s => (s - 1 + matches.length) % matches.length)
      return
    }
    if (matches.length > 0 && key.downArrow) {
      setSelected(s => (s + 1) % matches.length)
      return
    }
    // Vertical motion within a multi-line draft, once no dropdown claims the
    // arrow key above. This component has no prompt-history recall, so
    // there's no up/down fallback to worry about clobbering on a
    // single-line buffer -- the arrows are simply inert there, same as before.
    if (key.upArrow && value.includes('\n')) {
      setCursor(c => moveCursorVertically(value, c, -1))
      return
    }
    if (key.downArrow && value.includes('\n')) {
      setCursor(c => moveCursorVertically(value, c, 1))
      return
    }
    if (tabTarget !== undefined && key.tab) {
      completeToTarget(tabTarget)
      return
    }
    if (key.return) {
      // A dropdown is open and the typed text isn't already a complete,
      // exact command name — completing is needed before this can submit
      // (a raw partial line like bare "/" is certainly invalid and would
      // just get "unknown command: /"). If the prefix is unambiguous (one
      // match), there's nothing to disambiguate, so complete-and-submit
      // happen together in this same Enter — every command gets the same
      // one-press experience once its prefix is unique, not just short
      // ones like "/m". A genuinely ambiguous prefix (multiple matches)
      // still needs a second Enter, so the user sees what got picked
      // before it runs.
      if (tabTarget !== undefined && !matches.some(m => m.name === query)) {
        if (matches.length === 1) {
          const completedLine = '/' + tabTarget.name + ' '
          onSubmit(completedLine)
          setCursor(0)
          setSelected(0)
          return
        }
        completeToTarget(tabTarget)
        return
      }
      // A trailing backslash before the cursor is a portable "insert
      // newline" fallback for terminals that don't report Shift+Enter
      // distinctly from plain Enter.
      if (cursor > 0 && value[cursor - 1] === '\\') {
        onChange(value.slice(0, cursor - 1) + '\n' + value.slice(cursor))
        // Backslash -> newline is a like-for-like swap, so the offset holds.
        return
      }
      if (key.shift || key.meta) {
        onChange(value.slice(0, cursor) + '\n' + value.slice(cursor))
        setCursor(cursor + 1)
        return
      }
      onSubmit(value)
      setCursor(0)
      return
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const next = value.slice(0, cursor - 1) + value.slice(cursor)
        onChange(next)
        setCursor(cursor - 1)
        setSelected(0)
        setMentionSelected(0)
        setMentionDismissed(false)
      }
      return
    }
    if (key.leftArrow) {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.rightArrow) {
      setCursor(c => Math.min(value.length, c + 1))
      return
    }
    if (input !== '') {
      // Normalizes a multi-line paste's line endings so line-splitting
      // (rendering, Home/End, kill-line) only ever has to reason about `\n`.
      const normalized = input.replace(/\r\n?/g, '\n')
      const next = value.slice(0, cursor) + normalized + value.slice(cursor)
      onChange(next)
      setCursor(cursor + normalized.length)
      setSelected(0)
      setMentionSelected(0)
      setMentionDismissed(false)
    }
  })

  const placeholder = isCommandLine(value) ? 'type a command (see /help)' : 'type a message…'
  const nameWidth = Math.max(0, ...commands.map(c => c.name.length))
  const lines = value.split('\n')
  const { row: cursorRow, col: cursorCol } = computeRowCol(value, cursor)
  return (
    <Box flexDirection="column">
      {matches.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {matches.map((c, i) => (
            <Text key={c.name} inverse={i === selectedInRange}>
              {('/' + c.name).padEnd(nameWidth + 2)} {c.description}
            </Text>
          ))}
        </Box>
      )}
      {mentionOpen && fileIndex.candidates === undefined && (
        <Box paddingX={1}>
          <Text dimColor>loading files…</Text>
        </Box>
      )}
      {mentionOpen && fileIndex.candidates !== undefined && mentionMatches.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {mentionMatches.map((path, i) => (
            <Text key={path} inverse={i === mentionSelectedInRange}>{path}</Text>
          ))}
        </Box>
      )}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        {value === ''
          ? (
              <Box flexDirection="row">
                <Text color="cyan" bold>{'> '}</Text>
                <Text dimColor>{placeholder}</Text>
              </Box>
            )
          : lines.map((line, i) => (
              <Box key={i} flexDirection="row">
                <Text color="cyan" bold>{i === 0 ? '> ' : '  '}</Text>
                {renderLineContent(line, i === cursorRow ? cursorCol : null)}
              </Box>
            ))}
      </Box>
    </Box>
  )
}
