// Drawing for the context-cache panel. One design in two media: the desktop
// (and the editor, and the phone's pane) draws it as SVG at real pixel sizes
// (hooks/panel-svg.ts) with the host's own buttons; the terminal draws the
// same rows in text, with glyphs for the rings. Neither has a card or a
// background: text takes the theme, data colours read on light and dark.

import type { Elements, RenderElement } from 'claude-code'

import { fmtTokens, pct, type CacheView, type LimitView, type Tone, type ViewModel } from './model'
import { collapsedSvg, panelSvg } from './panel-svg'

export type Actions = {
  clear: () => void | Promise<void>
  compact: () => void | Promise<void>
  /** Folds the panel to one line or opens it again; absent where it cannot fold (the pane). */
  toggle?: () => void | Promise<void>
}

type TermEls = Elements['terminal']
type DeskEls = Elements['desktop'] | Elements['vscode'] | Elements['mobile']

const PX_PER_CELL = 8

// ── Terminal ───────────────────────────────────────────────────────────────

/** The terminal panel is laid out at most this wide, as the desktop's is at its design width. */
const MAX_COLUMNS = 76
const FILLED = '━'
const TRACK = '─'
const TICK = '│'

type Cell = { ch: string; color?: Tone; isDim: boolean }

/** The context bar as cells: a run per group, the auto-compact tick over it. */
export function contextCells(ctx: NonNullable<ViewModel['context']>, n: number): Cell[] {
  const cells: Cell[] = Array.from({ length: n }, () => ({ ch: TRACK, isDim: true }))
  let acc = 0
  for (const s of ctx.segments) {
    const start = Math.round((acc / ctx.window) * n)
    acc += s.tokens
    const end = Math.min(n, Math.round((acc / ctx.window) * n))
    for (let i = start; i < end; i++) cells[i] = { ch: FILLED, color: s.color, isDim: false }
  }
  if (ctx.compactPct !== null) cells[Math.min(n - 1, Math.floor((ctx.compactPct / 100) * n))] = { ch: TICK, isDim: false }
  return cells
}

const LIMIT_GLYPH = { session: '◷', weekly: '▦', fable: '✦' } as const
const cacheGlyph = (c: CacheView) => (c.state === 'cold' ? '❄' : c.state === 'empty' ? '○' : '♨')

export function renderTerminal(E: TermEls, vm: ViewModel, columns: number, actions: Actions, isCollapsed: boolean): RenderElement {
  const { Box, Text, Button } = E
  const cols = Math.max(24, Math.min(MAX_COLUMNS, columns))
  const ctx = vm.context
  const c = vm.cache

  const bar = (key: string, n: number) => {
    if (!ctx) return null
    const runs: Cell[] = []
    for (const cell of contextCells(ctx, n)) {
      const last = runs[runs.length - 1]
      if (last && last.color === cell.color && last.isDim === cell.isDim) last.ch += cell.ch
      else runs.push({ ...cell })
    }
    return (
      <Text key={key}>
        {runs.map(r => (
          <Text color={r.color} dimColor={r.isDim}>
            {r.ch}
          </Text>
        ))}
      </Text>
    )
  }
  const chevron = actions.toggle ? (
    <Button key="collapse" plain dimColor label={isCollapsed || !vm.fits ? '▸' : '▾'} onPress={actions.toggle} />
  ) : null
  const limitFigure = (l: LimitView) => (l.usage === null ? '—' : `${pct(l.usage)}%`)

  if (isCollapsed || !vm.fits) {
    return (
      <Box key="context-cache" flexDirection="row" alignItems="center" columnGap={1}>
        <Text>
          <Text bold>Context </Text>
          <Text dimColor>{ctx ? `${ctx.usedPct}%` : '—'}</Text>
        </Text>
        {cols >= 60 ? bar('bar-context', 10) : null}
        <Box flexShrink={1} minWidth={0}>
          <Text wrap="truncate">
            {vm.limits.map(l => (
              <Text>
                <Text color={l.color}>{`  ${LIMIT_GLYPH[l.kind]} `}</Text>
                <Text bold dimColor={l.usage === null}>
                  {limitFigure(l)}
                </Text>
              </Text>
            ))}
            <Text color={c.color}>{`  ${cacheGlyph(c)} ${c.label}`}</Text>
            {c.state === 'warm' || c.state === 'cooling' ? <Text dimColor>{` ${c.detail.split(' of ')[0]}`}</Text> : null}
          </Text>
        </Box>
        {chevron}
      </Box>
    )
  }

  // Row 1: Context, used, the bar, where auto-compact fires; the chevron at the end.
  const used = ctx ? `${fmtTokens(ctx.used)} / ${fmtTokens(ctx.window)} (${ctx.usedPct}%)` : ''
  const right = ctx?.compactPct == null ? '' : `${ctx.compactPct}%`
  const barW = Math.max(6, cols - 8 - used.length - 1 - (right ? right.length + 1 : 0) - (chevron ? 2 : 0) - 1)
  const contextRow = (
    <Box key="context" flexDirection="row" columnGap={1}>
      <Text bold>Context</Text>
      {ctx ? <Text dimColor>{used}</Text> : <Text dimColor>waiting for the first reading</Text>}
      {bar('bar-context', barW)}
      {right ? <Text dimColor>{right}</Text> : null}
      {ctx ? null : <Box flexGrow={1} />}
      {chevron}
    </Box>
  )

  // Row 2: the legend.
  const legend =
    ctx && vm.showLegend ? (
      <Text key="legend" wrap="truncate">
        {ctx.segments.map(s => (
          <Text>
            <Text color={s.color}>● </Text>
            <Text>{`${s.label} ${fmtTokens(s.tokens)}  `}</Text>
          </Text>
        ))}
        <Text dimColor>{`Free ${fmtTokens(ctx.free)}`}</Text>
      </Text>
    ) : null

  // Row 3: a "ring" per limit and one for the cache: glyph and figure, the time or warmth under it.
  const twoLines = cols >= 44
  const item = (key: string, glyph: string, color: Tone, main: RenderElement, sub: string) => (
    <Box key={key} flexDirection="column">
      <Text>
        <Text color={color}>{`${glyph} `}</Text>
        {main}
      </Text>
      {twoLines ? <Text dimColor>{`  ${sub}`}</Text> : null}
    </Box>
  )
  const rings = (
    <Box key="rings" flexDirection="row" justifyContent="space-between" width={cols}>
      {vm.limits.map(l =>
        item(
          `ring-${l.kind}`,
          LIMIT_GLYPH[l.kind],
          l.color,
          <Text bold dimColor={l.usage === null}>
            {limitFigure(l)}
          </Text>,
          l.time === null ? (l.usage === null ? 'No data' : ' ') : `Time ${pct(l.time)}%`,
        ),
      )}
      {item(
        'ring-cache',
        cacheGlyph(c),
        c.color,
        <Text bold color={c.color}>
          {c.label}
        </Text>,
        c.state === 'empty' ? 'Nothing cached' : `${pct(c.warmth * 100)}% warm`,
      )}
    </Box>
  )

  // Rows 4 and 5: the notice, then Clear and Compact.
  const notice = vm.showNotice ? (
    <Box key="notice" flexDirection="column">
      <Text wrap="wrap">
        <Text color={c.color}>● </Text>
        <Text>{vm.notice}</Text>
      </Text>
      <Box flexDirection="row" columnGap={1}>
        <Button key="clear" label="Clear" variant="primary" hotkey="c" onPress={actions.clear} />
        <Button key="compact" label="Compact" hotkey="k" onPress={actions.compact} />
      </Box>
    </Box>
  ) : null

  return (
    <Box key="context-cache" flexDirection="column" rowGap={1} width={cols}>
      <Box flexDirection="column">
        {contextRow}
        {legend}
      </Box>
      {rings}
      {notice}
    </Box>
  )
}

// ── Desktop, editor, phone ─────────────────────────────────────────────────

// Lucide chevron-up (fold) / chevron-down (open), as plan-progress draws its fold control: the picture centred in
// its cell and a blank Button over it, so the host draws its own hover and focus ring and takes the press.
const CHIP = 16
const chevronSvg = (isCollapsed: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CHIP}" height="${CHIP}" viewBox="0 0 24 24"><style>.c{stroke:#C2C0B6}` +
  `@media (prefers-color-scheme:light){.c{stroke:#3D3D3A}}</style>` +
  `<path class="c" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="${isCollapsed ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'}"/></svg>`

export function renderDesktop(E: DeskEls, vm: ViewModel, columns: number, actions: Actions, isCollapsed: boolean): RenderElement {
  const { Box, Button, Svg } = E
  // The chevron's cell comes off the width the drawing may take.
  const px = columns * PX_PER_CELL - (actions.toggle ? 32 : 0)
  const folded = isCollapsed || !vm.fits
  const chevron = actions.toggle ? (
    <Box key="collapse-cell" width={3} height={folded ? 1 : 2} flexShrink={0} justifyContent="center" alignItems="center">
      <Svg source={chevronSvg(folded)} alt={folded ? 'expand the panel' : 'collapse the panel'} width={CHIP} height={CHIP} />
      <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
        <Button key="collapse" plain label={'  '} onPress={actions.toggle} />
      </Box>
    </Box>
  ) : null

  if (folded) {
    const p = collapsedSvg(vm, px)
    return (
      <Box key="context-cache" flexDirection="row" alignItems="center" columnGap={1}>
        <Svg source={p.svg} alt={p.alt} width={p.width} height={p.height} isInteractive />
        <Box flexGrow={1} />
        {chevron}
      </Box>
    )
  }

  const p = panelSvg(vm, px)
  return (
    <Box key="context-cache" flexDirection="column" rowGap={1}>
      <Box flexDirection="row" alignItems="flex-start" columnGap={1}>
        <Svg source={p.svg} alt={p.alt} width={p.width} height={p.height} isInteractive />
        <Box flexGrow={1} />
        {chevron}
      </Box>
      {vm.showNotice ? (
        <Box flexDirection="row" columnGap={1}>
          <Button key="clear" label="Clear" variant="primary" hotkey="c" onPress={actions.clear} />
          <Button key="compact" label="Compact" hotkey="k" onPress={actions.compact} />
        </Box>
      ) : null}
    </Box>
  )
}
