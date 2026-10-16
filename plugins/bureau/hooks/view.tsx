// The pane: a header row, the office (cells on the terminal, an SVG on the desktop), a line per agent with its
// bubble, and the session's counts. Host elements and theme colours for the text, as the other mods draw.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { OfficeAgent, OfficeLead, OfficeStats } from '../types'
import { phaseOf, ROLES } from './model'
import { toCells, toSvg } from './pixels'
import { drawOffice, H, W, type SceneInput } from './scene'

type TermEls = Elements['terminal']
type DeskEls = Elements['desktop']

const NAME_W = 9
const ROLE_W = 10
const MAX_PX = 520

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function summary(agents: readonly OfficeAgent[], lead: OfficeLead): string {
  const working = agents.filter(a => a.state === 'working').length
  const done = agents.filter(a => a.state === 'done').length
  const parts = [lead.state === 'idle' ? 'Claude is idle' : lead.state === 'waiting' ? 'Claude waits on you' : 'Claude at work']
  if (working) parts.push(`${working} teammate${working === 1 ? '' : 's'} at work`)
  if (done) parts.push(`${done} done`)
  return parts.join(' · ')
}

export function renderPane(E: TermEls, surface: RenderSurface, s: SceneInput & { stats: OfficeStats }, columns: number): RenderElement {
  const { Box, Text } = E
  const alt = summary(s.agents, s.lead)
  const frame = drawOffice(s)
  let scene: RenderElement
  if (surface === 'terminal') {
    scene = <E.Raster key="office" columns={W} rows={H / 2} cells={toCells(frame)} />
  } else {
    const Svg = (E as unknown as DeskEls).Svg
    const scale = Math.max(2, Math.min(8, Math.floor(Math.min(MAX_PX, columns * 8) / W)))
    scene = <Svg source={toSvg(frame, scale, alt)} alt={alt} width={W * scale} height={H * scale} isInteractive />
  }

  const row = (key: string, dot: 'claude' | 'warning' | 'success' | 'error' | 'inactive', name: string, role: string, what: string, time: string) => (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Text color={dot}>●</Text>
      <Box width={NAME_W} flexShrink={0}>
        <Text wrap="truncate-end">{name}</Text>
      </Box>
      <Box width={ROLE_W} flexShrink={0}>
        <Text dimColor>{role}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{what}</Text>
      </Box>
      {time ? <Text dimColor>{time}</Text> : null}
    </Box>
  )

  const leadDot = s.lead.state === 'working' ? 'claude' : s.lead.state === 'waiting' ? 'warning' : 'inactive'
  const leadWhat = s.lead.state === 'idle' ? 'Waiting for your next message' : (s.lead.act?.label ?? 'Thinking')
  const team = s.agents.filter(a => phaseOf(a, s.now).at !== 'gone')
  const st = s.stats
  const counts = [
    `${st.agents} teammate${st.agents === 1 ? '' : 's'}`,
    `${st.searches} searches`,
    `${st.pages} pages`,
    `${st.reads} reads`,
    `${st.writes} edits`,
    `${st.commands} commands`,
  ].join(' · ')

  return (
    <Box key="bureau" flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="claude">▣ </Text>
          <Text bold>Bureau</Text>
          <Text dimColor>{` · ${alt}`}</Text>
        </Text>
        {scene}
      </Box>
      <Box flexDirection="column">
        {row('lead', leadDot, 'Claude', ROLES.lead.label, leadWhat, '')}
        {team.map(a => {
          const p = phaseOf(a, s.now)
          const what =
            a.desk < 0
              ? 'Waiting in the hallway for a desk'
              : p.at === 'in'
                ? `Walking in: ${a.task}`
                : a.state === 'done'
                  ? p.at === 'out'
                    ? 'Done, heading out'
                    : `Done: ${a.task}`
                  : a.state === 'error'
                    ? `Failed: ${a.task}`
                    : (a.act?.label ?? `Starting: ${a.task}`)
          const dot = a.state === 'done' ? 'success' : a.state === 'error' ? 'error' : p.at === 'in' ? 'inactive' : 'claude'
          return row(a.id, dot, a.name, ROLES[a.role].label, what, clock((a.endedAt ?? s.now) - a.startedAt))
        })}
        <Text dimColor wrap="truncate-end">{counts}</Text>
      </Box>
    </Box>
  )
}
