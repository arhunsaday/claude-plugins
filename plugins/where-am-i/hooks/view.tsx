// The recap above the prompt, laid out as the other mods in this marketplace: host elements and theme colours,
// a bold header row with dim detail and the fold chevron at its end, aligned labels, no card or background.

import type { Elements, RenderElement } from 'claude-code'

import type { WhereRecap } from '../types'
import { clip, elapsed } from './recap'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type Model = {
  recap: WhereRecap | null
  /** The goal until the first recap: the person's latest message. */
  prompt: string
  live: string
  isWorking: boolean
  since: number | null
  turns: number
  now: number
}

const LABEL_W = 7

export function renderBand(E: Els, m: Model, columns: number, isCollapsed: boolean, toggle: () => void): RenderElement | null {
  const { Box, Text, Button } = E
  const r = m.recap
  const goal = r?.goal ?? clip(m.prompt)
  if (!goal) return null
  const isProvisional = !r
  const doing = m.isWorking ? m.live || 'working' : (r?.now ?? '')
  const meta = [m.since !== null ? elapsed(m.now - m.since) : '', m.turns > 0 ? `${m.turns} turn${m.turns === 1 ? '' : 's'}` : '']
    .filter(Boolean)
    .join(' · ')
  const chevron = <Button key="collapse" plain dimColor label={isCollapsed ? '▸' : '▾'} onPress={toggle} />
  const status = m.isWorking ? <Text color="claude">{'● '}</Text> : <Text color="success">{'✓ '}</Text>

  if (isCollapsed) {
    return (
      <Box key="where-am-i" flexDirection="row" columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">
            <Text color="suggestion">{'◆ '}</Text>
            <Text bold dimColor={isProvisional}>{goal}</Text>
            {doing ? <Text dimColor>{'  ·  '}</Text> : null}
            {doing ? status : null}
            {doing ? <Text dimColor={!m.isWorking}>{clip(doing, 60)}</Text> : null}
            {r?.waiting ? <Text color="warning">{`  ·  ⏳ ${clip(r.waiting, 50)}`}</Text> : null}
          </Text>
        </Box>
        {chevron}
      </Box>
    )
  }

  const row = (key: string, label: RenderElement, body: RenderElement, trailing?: RenderElement | null) => (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Box width={LABEL_W} flexShrink={0}>
        {label}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {body}
      </Box>
      {trailing ?? null}
    </Box>
  )
  const showMeta = meta !== '' && columns >= 60

  return (
    <Box key="where-am-i" flexDirection="column">
      {row(
        'goal',
        <Text>
          <Text color="suggestion">{'◆ '}</Text>
          <Text bold>Goal</Text>
        </Text>,
        <Text bold={!isProvisional} dimColor={isProvisional} wrap="truncate-end">
          {goal}
        </Text>,
        <Box flexDirection="row" columnGap={1} flexShrink={0}>
          {showMeta ? <Text dimColor>{meta}</Text> : null}
          {chevron}
        </Box>,
      )}
      {doing
        ? row(
            'now',
            <Text dimColor>{'  Now'}</Text>,
            <Text wrap="truncate-end">
              {status}
              <Text>{doing}</Text>
            </Text>,
          )
        : null}
      {r?.next && !m.isWorking ? row('next', <Text dimColor>{'  Next'}</Text>, <Text wrap="truncate-end">{r.next}</Text>) : null}
      {r?.waiting
        ? row(
            'waiting',
            <Text color="warning">{'  You'}</Text>,
            <Text color="warning" wrap="truncate-end">
              {`⏳ ${r.waiting}`}
            </Text>,
          )
        : null}
    </Box>
  )
}
