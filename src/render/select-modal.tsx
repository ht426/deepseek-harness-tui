/**
 * Select modal: a generic option menu for slash commands (e.g. `/permission`).
 * Renders the projection-supplied options with the current value marked, and
 * resolves the chosen value (or `undefined` on cancel).
 */

import { Box, Text, useStdout } from 'ink'
import SelectInput from 'ink-select-input'
import type { TuiStore, PendingSelect } from '../store.ts'

export interface SelectModalProps {
  store: TuiStore
  select: PendingSelect
}

export function SelectModal({ store, select }: SelectModalProps): React.ReactNode {
  const { stdout } = useStdout()
  // Without a limit, ink-select-input renders every item unconditionally —
  // for a long list (e.g. the /model picker's 60+ entries) that's taller
  // than the terminal, so only the tail is visible and the initial
  // selection (and any upward movement into now-offscreen rows) is hidden.
  // Reserve room for the title/description above and the hint line below.
  const limit = Math.max(5, Math.min(20, (stdout.rows ?? 24) - 10))
  const items = select.options.map(option => ({
    label: option.value === select.currentValue ? `${option.label}  (current)` : option.label,
    value: option.value,
  }))
  const current = select.options.find(o => o.value === select.currentValue)
  const currentIndex = select.options.findIndex(o => o.value === select.currentValue)
  const initialIndex = currentIndex === -1 ? 0 : currentIndex
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" bold>⌁ {select.title}</Text>
      <Box paddingLeft={2} flexDirection="column">
        {current?.description !== undefined
          ? <Text color="gray">{current.description}</Text>
          : null}
        <SelectInput items={items} limit={limit} initialIndex={initialIndex} onSelect={(selected) => { store.answerSelect(selected.value) }} />
        <Text color="gray">↑/↓ select · Enter choose · Esc cancel</Text>
      </Box>
    </Box>
  )
}
