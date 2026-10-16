// The pane: a header row, the office as a picture (an SVG holding the frame's PNG on the desktop, the PNG itself on
// a terminal that shows pictures), a line per agent with its bubble, and the session's counts. Host elements and
// theme colours for the text, as the other mods draw.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { ROLES } from './engine/activity'
import { H, W, type Member, type Office } from './office'

type TermEls = Elements['terminal']
type DeskEls = Elements['desktop']

const NAME_W = 9
const ROLE_W = 15
const MAX_PX = 704

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function summary(o: Office): string {
  const team = [...o.members.values()]
  const working = team.filter(m => m.endedAt === null).length
  const parts = [o.leadLabel === null ? 'Max t’attend' : 'Max au travail']
  if (working) parts.push(`${working} agent${working > 1 ? 's' : ''} au travail`)
  return parts.join(' · ')
}

export function renderPane(E: TermEls, surface: RenderSurface, o: Office, png: string, columns: number, now: number): RenderElement {
  const { Box, Text } = E
  const alt = summary(o)
  let picture: RenderElement
  if (surface === 'terminal') {
    // a picture where the terminal can show one (kitty, Ghostty), its alt elsewhere; cells are about twice as tall as wide
    const cols = Math.max(20, Math.min(columns, 88))
    picture = <E.Image key="office" source={{ png }} columns={cols} rows={Math.round((cols * H) / W / 2)} alt={`${alt} (le bureau s’affiche dans un terminal qui montre les images : kitty, Ghostty)`} />
  } else {
    const Svg = (E as unknown as DeskEls).Svg
    const width = Math.max(W, Math.min(MAX_PX, columns * 8))
    const height = Math.round((width * H) / W)
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${W} ${H}">` +
      `<image href="data:image/png;base64,${png}" width="${W}" height="${H}" style="image-rendering:pixelated" image-rendering="pixelated"/></svg>`
    picture = <Svg key="office" source={source} alt={alt} width={width} height={height} />
  }

  const row = (key: string, dot: 'claude' | 'warning' | 'success' | 'error' | 'inactive', name: string, role: string, what: string, time: string) => (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Text color={dot}>●</Text>
      <Box width={NAME_W} flexShrink={0}>
        <Text wrap="truncate-end">{name}</Text>
      </Box>
      <Box width={ROLE_W} flexShrink={0}>
        <Text dimColor wrap="truncate-end">
          {role}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{what}</Text>
      </Box>
      {time ? <Text dimColor>{time}</Text> : null}
    </Box>
  )
  const memberRow = (m: Member) =>
    row(
      m.id,
      m.endedAt === null ? 'claude' : m.ok ? 'success' : 'error',
      m.name,
      ROLES[m.role].label,
      m.endedAt === null ? m.label : `${m.label} · ${m.task}`,
      clock((m.endedAt ?? now) - m.startedAt),
    )
  const s = o.stats
  const counts = [
    `${s.agents} agent${s.agents > 1 ? 's' : ''}`,
    `${s.searches} recherches`,
    `${s.pages} pages`,
    `${s.reads} lectures`,
    `${s.writes} écritures`,
    `${s.commands} commandes`,
  ].join(' · ')

  return (
    <Box key="bureau" flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="claude">▣ </Text>
          <Text bold>Bureau</Text>
          <Text dimColor>{` · ${alt}`}</Text>
        </Text>
        {picture}
      </Box>
      <Box flexDirection="column">
        {row('chef', o.leadLabel === null ? 'inactive' : 'claude', 'Max', 'Claude, chef', o.leadLabel ?? 'Attend ton prochain message', '')}
        {[...o.members.values()].map(memberRow)}
        <Text dimColor wrap="truncate-end">
          {counts}
        </Text>
      </Box>
    </Box>
  )
}
