/**
 * Select modal: a generic option menu for slash commands (e.g. `/permission`).
 * Renders the projection-supplied options with the current value marked, and
 * resolves the chosen value (or `undefined` on cancel).
 */

import { Box, Text } from 'ink'
import SelectInput from 'ink-select-input'
import type { TuiStore, PendingSelect } from '../store.ts'

export interface SelectModalProps {
  store: TuiStore
  select: PendingSelect
}

export function SelectModal({ store, select }: SelectModalProps): React.ReactNode {
  const items = select.options.map(option => ({
    label: option.value === select.currentValue ? `${option.label}  (current)` : option.label,
    value: option.value,
  }))
  const current = select.options.find(o => o.value === select.currentValue)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" bold>⌁ {select.title}</Text>
      <Box paddingLeft={2} flexDirection="column">
        {current?.description !== undefined
          ? <Text color="gray">{current.description}</Text>
          : null}
        <SelectInput items={items} onSelect={(selected) => { store.answerSelect(selected.value) }} />
        <Text color="gray">↑/↓ select · Enter choose · Esc cancel</Text>
      </Box>
    </Box>
  )
}
