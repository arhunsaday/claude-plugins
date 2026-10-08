// The held command, as a pane (or above the prompt where no pane fits). Host elements and theme colours only,
// laid out as the other mods in this marketplace: a bold header, dim detail, a blank row between sections,
// the buttons on their own row with the safe choice first.

import type { Elements, RenderElement } from 'claude-code'

import type { BlastRisk, BlastSeverity, HeldCommand } from '../types'

export type Decision = 'proceed' | 'cancel' | 'allow'

const TITLE: Record<BlastRisk, string> = {
  delete: 'Deletes files',
  'force-push': 'Force push',
  'git-discard': 'Discards git changes',
  'git-clean': 'Deletes untracked files',
  'branch-delete': 'Deletes branches',
  migration: 'Database migration',
  'sql-drop': 'Destructive SQL',
}

const SEVERITY_COLOR: Record<BlastSeverity, 'error' | 'warning'> = { critical: 'error', high: 'error', medium: 'warning' }
const SEVERITY_LABEL: Record<BlastSeverity, string> = { critical: 'critical', high: 'high risk', medium: 'medium risk' }

/** Whether the recovery line is good news, mixed, or bad. */
function recoveryTone(text: string): 'success' | 'warning' | 'error' {
  if (/gone for good|Only a backup|nothing to restore|nowhere else/.test(text)) return 'error'
  if (/^All are tracked|^No remote commit/.test(text)) return 'success'
  return 'warning'
}

const BAR = 12

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Code'>

export function report(E: Els, one: HeldCommand, decide: (id: string, d: Decision) => void): RenderElement {
  const { Box, Text, Button, Code } = E
  const color = SEVERITY_COLOR[one.severity]
  const isBand = one.where === 'band'
  const shown = one.items.slice(0, isBand ? 4 : 12)
  const more = one.total - shown.length
  const noteW = Math.max(0, ...shown.map(i => (i.note ?? '').length))

  const countdown =
    one.secondsLeft !== null && one.timeoutSeconds ? (
      <Text key="countdown" dimColor={one.secondsLeft > 10} color={one.secondsLeft <= 10 ? 'warning' : undefined}>
        {`auto-cancels in ${one.secondsLeft} s `}
        <Text color={one.secondsLeft <= 10 ? 'warning' : undefined}>{'━'.repeat(Math.max(1, Math.round((one.secondsLeft / one.timeoutSeconds) * BAR)))}</Text>
        <Text dimColor>{'─'.repeat(Math.max(0, BAR - Math.round((one.secondsLeft / one.timeoutSeconds) * BAR)))}</Text>
      </Text>
    ) : null

  return (
    <Box key="blast-radius" flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={color}>{'⚠ '}</Text>
          <Text bold>{TITLE[one.risk]}</Text>
          <Text dimColor>{' · '}</Text>
          <Text color={color}>{SEVERITY_LABEL[one.severity]}</Text>
        </Text>
        <Code source={one.command} language="bash" wrap={isBand ? 'truncate-end' : 'wrap'} />
      </Box>

      <Box flexDirection="column">
        <Text bold wrap="wrap">{`Would ${one.summary}`}</Text>
        {one.warnings.map(w => (
          <Text color="error" wrap="wrap">{`✖ ${w}`}</Text>
        ))}
        {one.recovery ? (
          <Text wrap="wrap">
            <Text color={recoveryTone(one.recovery)}>{'● '}</Text>
            <Text dimColor>{one.recovery}</Text>
          </Text>
        ) : null}
      </Box>

      {shown.length > 0 ? (
        <Box flexDirection="column">
          {shown.map(item => (
            <Box flexDirection="row" columnGap={2}>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text wrap="truncate-middle">{`  ${item.label}`}</Text>
              </Box>
              {noteW > 0 ? (
                <Box width={noteW} flexShrink={0}>
                  <Text dimColor>{item.note ?? ''}</Text>
                </Box>
              ) : null}
            </Box>
          ))}
          {more > 0 ? <Text dimColor>{`  … and ${more} more`}</Text> : null}
        </Box>
      ) : null}

      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Button key="cancel" label="Cancel" hotkey="c" variant="primary" autoFocus onPress={() => decide(one.id, 'cancel')} />
        <Button key="proceed" label="Proceed" hotkey="y" onPress={() => decide(one.id, 'proceed')} />
        <Button key="allow" label="Allow this session" hotkey="a" onPress={() => decide(one.id, 'allow')} />
        {countdown}
      </Box>
    </Box>
  )
}
