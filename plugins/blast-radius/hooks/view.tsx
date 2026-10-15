// The held command, as a pane (or above the prompt where no pane fits). Host elements and theme colours only,
// laid out as the other mods in this marketplace: a coloured glyph, a bold title and dim detail after ` · `,
// status dots in their colour before default text, a blank row between sections, the buttons on their own row
// with the safe choice first.

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

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Code'>

export function report(E: Els, one: HeldCommand, decide: (id: string, d: Decision) => void): RenderElement {
  const { Box, Text, Button, Code } = E
  const color = SEVERITY_COLOR[one.severity]
  const isBand = one.where === 'band'
  const shown = one.items.slice(0, isBand ? 4 : 12)
  const more = one.total - shown.length
  const noteW = Math.max(0, ...shown.map(i => (i.note ?? '').length))

  // The countdown is header detail: dim, in the warning colour for its last ten seconds.
  const countdown =
    one.secondsLeft !== null && one.timeoutSeconds ? (
      <Text dimColor={one.secondsLeft > 10} color={one.secondsLeft <= 10 ? 'warning' : undefined}>
        {` · auto-cancels in ${one.secondsLeft} s`}
      </Text>
    ) : null

  return (
    <Box key="blast-radius" flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={color}>{'⚠ '}</Text>
          <Text bold>{TITLE[one.risk]}</Text>
          <Text dimColor>{` · ${SEVERITY_LABEL[one.severity]}`}</Text>
          {countdown}
        </Text>
        <Code source={one.command} language="bash" wrap={isBand ? 'truncate-end' : 'wrap'} />
      </Box>

      <Box flexDirection="column">
        <Text wrap="wrap">{`Would ${one.summary}`}</Text>
        {one.warnings.map(w => (
          <Text wrap="wrap">
            <Text color="error">{'● '}</Text>
            <Text>{w}</Text>
          </Text>
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

      <Box flexDirection="row" columnGap={1}>
        <Button key="cancel" label="Cancel" hotkey="c" variant="primary" autoFocus onPress={() => decide(one.id, 'cancel')} />
        <Button key="proceed" label="Proceed" hotkey="y" onPress={() => decide(one.id, 'proceed')} />
        <Button key="allow" label="Allow this session" hotkey="a" onPress={() => decide(one.id, 'allow')} />
      </Box>
    </Box>
  )
}
