/**
 * Approval modal: renders a permission request as an allow/deny menu,
 * borderless under a colored header.
 */

import { Box, Text } from 'ink'
import SelectInput from 'ink-select-input'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { TuiStore, PendingApproval } from '../store.ts'

export interface ApprovalModalProps {
  store: TuiStore
  approval: PendingApproval
}

export function ApprovalModal({ store, approval }: ApprovalModalProps): React.ReactNode {
  const items: Array<{ label: string; value: ApprovalOutcome }> = [
    { label: 'Allow once', value: 'allowed-once' },
    { label: 'Reject', value: 'rejected' },
  ]
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="red" bold>⌁ approval required</Text>
      <Box paddingLeft={2} flexDirection="column">
        <Text>Allow the tool <Text color="cyan" bold>{approval.toolName}</Text> to proceed?</Text>
        {approval.reason !== undefined && approval.reason !== ''
          ? <Text color="gray">{approval.reason}</Text>
          : null}
        <SelectInput items={items} onSelect={(selected) => { store.answerApproval(selected.value) }} />
        <Text color="gray">↑/↓ select · Enter choose · Esc reject</Text>
      </Box>
    </Box>
  )
}
