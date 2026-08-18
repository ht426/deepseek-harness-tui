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

export function InputBar({ value, onChange, onSubmit }: InputBarProps): React.ReactNode {
  const [cursor, setCursor] = useState(value.length)

  useInput((input, key) => {
    if (key.ctrl || key.meta) return // chords belong to the App
    if (key.return) {
      onSubmit(value)
      setCursor(0)
      return
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const next = value.slice(0, cursor - 1) + value.slice(cursor)
        onChange(next)
        setCursor(cursor - 1)
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
    }
  })

  const placeholder = isCommandLine(value) ? 'type a command (see /help)' : 'type a message…'
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="row">
      <Text color="cyan" bold>{'> '}</Text>
      {value === ''
        ? <Text dimColor>{placeholder}</Text>
        : renderLineContent(value, cursor)}
    </Box>
  )
}
