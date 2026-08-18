/**
 * Input bar: the `>` prompt. A slash-leading line dispatches as a command;
 * anything else is a free-text prompt.
 *
 * Custom input (not ink-text-input) so modifier chords (Ctrl+O, Ctrl+T, Esc)
 * can be consumed here instead of leaking into the input value. The App owns
 * the global chords; this component handles only printable text, backspace,
 * and Enter.
 */

import { Box, Text } from 'ink'
import { useInput } from 'ink'
import { useState } from 'react'
import type { TuiController } from '../controller.ts'

export interface InputBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (line: string) => void
  controller: TuiController
}

/** Whether a line is a slash command. */
export function isCommandLine(line: string): boolean {
  return line.startsWith('/')
}

/** Whether the input is mid-typing a slash command (no space yet) and, if so, its query text. */
function commandQuery(value: string): { isCommandMode: boolean; query: string } {
  const isCommandMode = value.startsWith('/') && !value.includes(' ')
  return { isCommandMode, query: isCommandMode ? value.slice(1) : '' }
}

type Command = ReturnType<TuiController['listCommands']>[number]

/** Slash commands whose name starts with `query`, prefix-filtered as the user types. */
function matchSlashCommands(commands: readonly Command[], query: string): Command[] {
  return commands.filter(c => c.name.startsWith(query))
}

/** Renders a line with the character at `cursorCol` inverted as a visible block cursor. */
function renderLineContent(line: string, cursorCol: number): React.ReactNode {
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

export function InputBar({ value, onChange, onSubmit, controller }: InputBarProps): React.ReactNode {
  const [cursor, setCursor] = useState(value.length)
  const [selected, setSelected] = useState(0)

  const commands = controller.listCommands()
  const { isCommandMode, query } = commandQuery(value)
  const matches = isCommandMode ? matchSlashCommands(commands, query) : []
  // Defensive clamp: an arrow-key press processed in the same input batch as a
  // still-pending text change can compute `selected` against a stale, wider
  // match list. Clamping at render time keeps the highlight in range instead
  // of pointing past the end of the freshly-filtered list.
  const selectedInRange = matches.length === 0 ? 0 : Math.min(selected, matches.length - 1)

  useInput((input, key) => {
    const tabTarget = matches[selectedInRange]
    const completeToTarget = (target: Command): void => {
      const completed = '/' + target.name + ' '
      onChange(completed)
      setCursor(completed.length)
      setSelected(0)
    }

    if (key.ctrl || key.meta) return // chords belong to the App
    if (matches.length > 0 && key.upArrow) {
      setSelected(s => (s - 1 + matches.length) % matches.length)
      return
    }
    if (matches.length > 0 && key.downArrow) {
      setSelected(s => (s + 1) % matches.length)
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
      const next = value.slice(0, cursor) + input + value.slice(cursor)
      onChange(next)
      setCursor(cursor + input.length)
      setSelected(0)
    }
  })

  const placeholder = isCommandLine(value) ? 'type a command (see /help)' : 'type a message…'
  const nameWidth = Math.max(0, ...commands.map(c => c.name.length))
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
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="row">
        <Text color="cyan" bold>{'> '}</Text>
        {value === ''
          ? <Text dimColor>{placeholder}</Text>
          : renderLineContent(value, cursor)}
      </Box>
    </Box>
  )
}
