/**
 * Question modal: renders an `ask_user_question` request as a selectable menu
 * or a free-text input when the question has no options. Borderless, indented
 * under a colored header, matching the Claude Code-style layout.
 */

import { Box, Text } from 'ink'
import { useState } from 'react'
import SelectInput from 'ink-select-input'
import TextInput from 'ink-text-input'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { TuiStore, PendingQuestion } from '../store.ts'

export interface QuestionModalProps {
  store: TuiStore
  question: PendingQuestion
}

/** One question's interactive body. */
function QuestionBody({ store, item }: { store: TuiStore; item: AskUserQuestionItem }): React.ReactNode {
  const [custom, setCustom] = useState('')
  const answer = (selected: string[]): void => {
    store.answerQuestion({ answers: [{ id: item.id, selected, ...(custom === '' ? {} : { custom }) }] })
  }

  if (item.options !== undefined && item.options.length > 0) {
    const items = item.options.map(option => ({ label: option.label, value: option.label }))
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <SelectInput items={items} onSelect={(selected) => { answer([selected.value]) }} />
        <Text color="gray">↑/↓ select · Enter choose · Esc cancel</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <TextInput value={custom} onChange={setCustom} onSubmit={() => answer([])} placeholder="answer…" />
      <Text color="gray">type an answer and press Enter</Text>
    </Box>
  )
}

export function QuestionModal({ store, question }: QuestionModalProps): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>⌁ question</Text>
      {question.request.questions.map((item, i) => (
        <Box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1} paddingLeft={2}>
          {item.header !== undefined ? <Text bold>{item.header}</Text> : null}
          <Text>{item.question}</Text>
          {item.detail !== undefined ? <Text color="gray">{item.detail}</Text> : null}
          <QuestionBody store={store} item={item} />
        </Box>
      ))}
    </Box>
  )
}
