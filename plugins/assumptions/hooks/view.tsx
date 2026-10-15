// The strip and the list, laid out as the other mods in this marketplace: host elements and theme colours, a
// coloured glyph with a bold title and dim detail after ` · `, the fold chevron at the end of that row, status dots
// before default text, the buttons on their own row under the list. No card or background.

import type { Elements, RenderElement } from 'claude-code'

import type { Assumption, AssumptionVerdict } from '../types'
import { toCheck } from './model'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type DeskSvg = Elements['desktop']['Svg']

export type Actions = {
  mark: (id: number, verdict: AssumptionVerdict) => void
  allRight: () => void
  clearChecked: () => void
  /** Folds the band to its strip or opens it; absent in the pane. */
  toggle?: () => void
}

const DOT: Record<AssumptionVerdict, 'inactive' | 'success' | 'error'> = { unchecked: 'inactive', right: 'success', wrong: 'error' }

// Lucide chevron-up (fold) / chevron-down (open), drawn as the other mods draw theirs on the desktop: the picture
// centred in its cell and a blank Button over it, so the host draws its own hover and focus ring and takes the press.
const CHIP = 16
const chevronSvg = (isCollapsed: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CHIP}" height="${CHIP}" viewBox="0 0 24 24"><style>.c{stroke:#C2C0B6}` +
  `@media (prefers-color-scheme:light){.c{stroke:#3D3D3A}}</style>` +
  `<path class="c" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="${isCollapsed ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'}"/></svg>`

function chevronFor(E: Els, isDesktop: boolean, isCollapsed: boolean, toggle: () => void): RenderElement {
  const { Box, Button } = E
  if (!isDesktop) return <Button key="collapse" plain dimColor label={isCollapsed ? '▸' : '▾'} onPress={toggle} />
  const Svg = (E as unknown as { Svg: DeskSvg }).Svg
  return (
    <Box key="collapse-cell" width={3} height={1} flexShrink={0} justifyContent="center" alignItems="center">
      <Svg source={chevronSvg(isCollapsed)} alt={isCollapsed ? 'expand the assumptions' : 'collapse the assumptions'} width={CHIP} height={CHIP} />
      <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
        <Button key="collapse" plain label={'  '} onPress={toggle} />
      </Box>
    </Box>
  )
}

function header(E: Els, items: readonly Assumption[], chevron: RenderElement | null) {
  const { Box, Text } = E
  const left = toCheck(items)
  const n = items.length
  return (
    <Box key="header" flexDirection="row" columnGap={1}>
      <Text color={left > 0 ? 'warning' : 'success'}>◆</Text>
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text bold>{`Claude made ${n} assumption${n === 1 ? '' : 's'}`}</Text>
          <Text dimColor>{left > 0 ? ` · ${left} to check` : ' · all checked'}</Text>
        </Text>
      </Box>
      <Box flexGrow={1} />
      {chevron}
    </Box>
  )
}

function row(E: Els, a: Assumption, idW: number, actions: Actions) {
  const { Box, Text, Button } = E
  const controls =
    a.verdict === 'unchecked' ? (
      <Box flexDirection="row" columnGap={1} flexShrink={0}>
        <Button key={`right-${a.id}`} plain dimColor label="right" onPress={() => actions.mark(a.id, 'right')} />
        <Button key={`wrong-${a.id}`} plain dimColor label="wrong" onPress={() => actions.mark(a.id, 'wrong')} />
      </Box>
    ) : a.verdict === 'right' ? (
      <Box flexDirection="row" columnGap={1} flexShrink={0}>
        <Text dimColor>right</Text>
        <Button key={`undo-${a.id}`} plain dimColor label="undo" onPress={() => actions.mark(a.id, 'unchecked')} />
      </Box>
    ) : (
      <Box flexShrink={0}>
        <Text dimColor>{a.fixSentAt === null ? 'wrong' : 'fix sent'}</Text>
      </Box>
    )
  return (
    <Box key={`a-${a.id}`} flexDirection="row" columnGap={1}>
      <Text color={DOT[a.verdict]}>●</Text>
      <Box width={idW} flexShrink={0}>
        <Text dimColor>{`#${a.id}`}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text>{a.text}</Text>
          {a.where ? <Text dimColor>{` · ${a.where}`}</Text> : null}
        </Text>
      </Box>
      {controls}
    </Box>
  )
}

/** The guesses to show in `rows` lines: the unchecked first, then the latest checked ones. */
export function visible(items: readonly Assumption[], rows: number): { shown: Assumption[]; more: number } {
  const unchecked = items.filter(a => a.verdict === 'unchecked')
  const checked = items.filter(a => a.verdict !== 'unchecked').reverse()
  const ordered = [...unchecked, ...checked]
  if (ordered.length <= rows) return { shown: ordered.sort((a, b) => a.id - b.id), more: 0 }
  const shown = ordered.slice(0, Math.max(1, rows - 1)).sort((a, b) => a.id - b.id)
  return { shown, more: ordered.length - shown.length }
}

export type ListOpts = {
  isDesktop: boolean
  isCollapsed: boolean
  /** Lines the list may take; the pane passes enough for all. */
  rows: number
  isPane: boolean
}

export function renderList(E: Els, items: readonly Assumption[], actions: Actions, o: ListOpts): RenderElement {
  const { Box, Text, Button } = E
  const chevron = actions.toggle ? chevronFor(E, o.isDesktop, o.isCollapsed, actions.toggle) : null
  if (o.isCollapsed && !o.isPane) {
    return (
      <Box key="assumptions" flexDirection="column">
        {header(E, items, chevron)}
      </Box>
    )
  }
  const { shown, more } = visible(items, o.rows)
  const idW = String(items.reduce((n, a) => Math.max(n, a.id), 0)).length + 1
  const hasChecked = items.some(a => a.verdict !== 'unchecked')
  return (
    <Box key="assumptions" flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        {header(E, items, chevron)}
        {shown.map(a => row(E, a, idW, actions))}
        {more > 0 ? <Text dimColor>{`  +${more} more · /assumptions opens the full list`}</Text> : null}
      </Box>
      {toCheck(items) > 0 || hasChecked ? (
        <Box flexDirection="row" columnGap={1}>
          {toCheck(items) > 0 ? <Button key="all-right" label="All right" variant="primary" hotkey="a" onPress={actions.allRight} /> : null}
          {hasChecked ? <Button key="clear-checked" label="Clear checked" hotkey="c" onPress={actions.clearChecked} /> : null}
        </Box>
      ) : null}
    </Box>
  )
}
