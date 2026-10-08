// Drawing for the context-cache panel: one layout for every surface, drawn
// with the host's own elements and theme colours, no card or background.
// Only the bars differ: text glyphs on the terminal, thin SVG strips elsewhere.

import type { Elements, RenderElement } from 'claude-code'

import { barColumns, fmtTokens, LABEL_COLUMNS, pct, type CacheView, type LimitView, type Tone, type ViewModel } from './model'

export type Actions = {
  clear: () => void | Promise<void>
  compact: () => void | Promise<void>
  /** Folds the panel to one line or opens it again; absent where it cannot fold (the pane). */
  toggle?: () => void | Promise<void>
}

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type TermEls = Elements['terminal']
type DeskEls = Elements['desktop'] | Elements['vscode'] | Elements['mobile']

/** One run of a bar, as fractions of its length; `isDim` for the elapsed-time layer of a limit. */
type BarPart = { from: number; to: number; color: Tone; isDim?: boolean }
type Bar = { parts: BarPart[]; tickAt?: number }

/** What differs per surface: how a bar and the fold chevron are drawn. */
type Painter = {
  bar: (key: string, bar: Bar, columns: number) => RenderElement
  chevron: (isCollapsed: boolean, onPress: () => void | Promise<void>) => RenderElement
}

// ── Bars ───────────────────────────────────────────────────────────────────

function contextBar(ctx: NonNullable<ViewModel['context']>): Bar {
  let acc = 0
  const parts = ctx.segments.map(s => {
    const from = acc / ctx.window
    acc += s.tokens
    return { from, to: Math.min(1, acc / ctx.window), color: s.color }
  })
  return { parts, tickAt: ctx.compactPct === null ? undefined : ctx.compactPct / 100 }
}

function limitBar(l: LimitView): Bar {
  const u = (l.usage ?? 0) / 100
  const t = (l.time ?? 0) / 100
  return {
    parts: [
      { from: 0, to: u, color: l.color },
      { from: u, to: Math.max(u, t), color: l.color, isDim: true },
    ],
  }
}

function cacheBar(c: CacheView): Bar {
  return { parts: c.state === 'empty' ? [] : [{ from: 0, to: c.warmth, color: c.color }] }
}

// ── Copy ───────────────────────────────────────────────────────────────────

const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s)

/** "59m left of 60m" → "59m left"; the collapsed line's short form. */
const shortDetail = (c: CacheView) =>
  c.state === 'warm' || c.state === 'cooling' ? ` ${c.detail.split(' of ')[0]}` : ''

// ── The panel ──────────────────────────────────────────────────────────────

function expanded(E: Els, p: Painter, vm: ViewModel, columns: number, actions: Actions): RenderElement {
  const { Box, Text, Button } = E
  const barW = barColumns(columns)
  const full = vm.detail === 'full'
  const some = vm.detail !== 'none'

  const row = (key: string, label: string, bar: RenderElement, figures: RenderElement, trailing?: RenderElement | null) => (
    <Box key={key} flexDirection="row" alignItems="center" columnGap={1}>
      <Box width={LABEL_COLUMNS - 1} flexShrink={0}>
        <Text wrap="truncate">{label}</Text>
      </Box>
      {bar}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {figures}
      </Box>
      {trailing ?? null}
    </Box>
  )

  const ctx = vm.context
  const chevron = actions.toggle ? p.chevron(false, actions.toggle) : null
  const contextRow = row(
    'context',
    'Context',
    p.bar('bar-context', ctx ? contextBar(ctx) : { parts: [] }, barW),
    ctx ? (
      <Text wrap="truncate">
        <Text>{`${ctx.usedPct}%`}</Text>
        <Text dimColor>{` · ${fmtTokens(ctx.used)} of ${fmtTokens(ctx.window)}`}</Text>
        {full && ctx.compactPct !== null ? <Text dimColor>{` · auto-compact at ${ctx.compactPct}%`}</Text> : null}
      </Text>
    ) : (
      <Text dimColor wrap="truncate">waiting for the first reading</Text>
    ),
    chevron,
  )

  const legend =
    ctx && vm.showLegend ? (
      <Box key="legend" marginLeft={LABEL_COLUMNS}>
        <Text wrap="truncate">
          {ctx.segments.map(s => (
            <Text>
              <Text color={s.color}>● </Text>
              <Text dimColor>{`${s.label} ${fmtTokens(s.tokens)}  `}</Text>
            </Text>
          ))}
          <Text dimColor>{`Free ${fmtTokens(ctx.free)}`}</Text>
        </Text>
      </Box>
    ) : null

  const limitRows = vm.limits.map(l =>
    row(
      `limit-${l.kind}`,
      l.title,
      p.bar(`bar-${l.kind}`, limitBar(l), barW),
      l.usage === null ? (
        <Text dimColor wrap="truncate">no data</Text>
      ) : (
        <Text wrap="truncate">
          <Text color={l.color}>{`${pct(l.usage)}%`}</Text>
          {some ? <Text dimColor>{` · ${lower(l.reset)}`}</Text> : null}
          {full && l.time !== null ? <Text dimColor>{` · ${pct(l.time)}% of window gone`}</Text> : null}
        </Text>
      ),
    ),
  )

  const c = vm.cache
  const cacheRow = row(
    'cache',
    'Cache',
    p.bar('bar-cache', cacheBar(c), barW),
    <Text wrap="truncate">
      <Text color={c.color}>{c.label}</Text>
      {some ? <Text dimColor>{` · ${lower(c.detail)}`}</Text> : null}
      {full && c.hit !== null ? <Text dimColor>{` · hit ${pct(c.hit)}%`}</Text> : null}
    </Text>,
  )

  const notice = vm.showNotice ? (
    <Box key="notice" flexDirection="row" alignItems="center" columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate">
          <Text color={c.color}>● </Text>
          <Text dimColor>{vm.notice}</Text>
        </Text>
      </Box>
      <Button key="clear" label="Clear" hotkey="c" onPress={actions.clear} />
      <Button key="compact" label="Compact" hotkey="k" onPress={actions.compact} />
    </Box>
  ) : null

  return (
    <Box key="context-cache" flexDirection="column">
      {contextRow}
      {legend}
      {limitRows}
      {cacheRow}
      {notice}
    </Box>
  )
}

/** One line: context with a short bar, each limit's figure, the cache's state; the chevron opens the panel. */
function collapsed(E: Els, p: Painter, vm: ViewModel, columns: number, actions: Actions): RenderElement {
  const { Box, Text } = E
  const ctx = vm.context
  const c = vm.cache
  return (
    <Box key="context-cache" flexDirection="row" alignItems="center" columnGap={1}>
      <Text>
        <Text>Context </Text>
        <Text dimColor={ctx === null}>{ctx ? `${ctx.usedPct}%` : '—'}</Text>
      </Text>
      {ctx && columns >= 80 ? p.bar('bar-context', contextBar(ctx), 10) : null}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate">
          {vm.limits.map(l => (
            <Text>
              <Text dimColor>{` · ${l.title} `}</Text>
              <Text color={l.usage === null ? undefined : l.color} dimColor={l.usage === null}>
                {l.usage === null ? '—' : `${pct(l.usage)}%`}
              </Text>
            </Text>
          ))}
          <Text dimColor> · Cache </Text>
          <Text color={c.color}>{lower(c.label)}</Text>
          <Text dimColor>{shortDetail(c)}</Text>
        </Text>
      </Box>
      {actions.toggle ? p.chevron(true, actions.toggle) : null}
    </Box>
  )
}

function panel(E: Els, p: Painter, vm: ViewModel, columns: number, actions: Actions, isCollapsed: boolean): RenderElement {
  return isCollapsed || !vm.fits ? collapsed(E, p, vm, columns, actions) : expanded(E, p, vm, columns, actions)
}

// ── Terminal ───────────────────────────────────────────────────────────────

const FILLED = '━'
const TRACK = '─'
const TICK = '│'

type Cell = { ch: string; color?: Tone; isDim: boolean }

export function barCells(bar: Bar, n: number): Cell[] {
  const cells: Cell[] = Array.from({ length: n }, (_, i) => {
    const x = (i + 0.5) / n
    const part = bar.parts.find(s => x >= s.from && x < s.to)
    return part ? { ch: FILLED, color: part.color, isDim: !!part.isDim } : { ch: TRACK, isDim: true }
  })
  if (bar.tickAt !== undefined) cells[Math.min(n - 1, Math.floor(bar.tickAt * n))] = { ch: TICK, isDim: false }
  return cells
}

export function renderTerminal(E: TermEls, vm: ViewModel, columns: number, actions: Actions, isCollapsed: boolean): RenderElement {
  const { Text, Button } = E
  const painter: Painter = {
    bar: (key, bar, n) => {
      const runs: Cell[] = []
      for (const c of barCells(bar, n)) {
        const last = runs[runs.length - 1]
        if (last && last.color === c.color && last.isDim === c.isDim) last.ch += c.ch
        else runs.push({ ...c })
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
    },
    chevron: (folded, onPress) => (
      <Button key="collapse" plain dimColor label={folded ? '▸' : '▾'} onPress={onPress} />
    ),
  }
  return panel(E, painter, vm, Math.max(20, columns), actions, isCollapsed)
}

// ── Desktop, editor, phone ─────────────────────────────────────────────────

// The SVG cannot read the host's theme keys: mid-tone equivalents that read on light and dark alike.
const HEX: Record<Tone, string> = {
  claude: '#D97757',
  suggestion: '#5B8DEF',
  merged: '#9B7BEA',
  inactive: '#8E8B85',
  success: '#4CAF6A',
  warning: '#D9A040',
  error: '#E0574A',
}
const PX_PER_CELL = 8
const BAR_H = 6

function barSvg(bar: Bar, width: number): string {
  const r = BAR_H / 2
  const rects = bar.parts
    .filter(s => s.to > s.from)
    .map(
      s =>
        `<rect x="${(s.from * width).toFixed(1)}" width="${((s.to - s.from) * width).toFixed(1)}" height="${BAR_H}" fill="${HEX[s.color]}"${s.isDim ? ' fill-opacity=".35"' : ''}/>`,
    )
    .join('')
  const tick =
    bar.tickAt === undefined
      ? ''
      : `<rect x="${Math.min(width - 2, bar.tickAt * width).toFixed(1)}" width="2" height="${BAR_H}" fill="#8E8B85"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR_H}" viewBox="0 0 ${width} ${BAR_H}">` +
    `<clipPath id="r"><rect width="${width}" height="${BAR_H}" rx="${r}"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${width}" height="${BAR_H}" fill="#808080" fill-opacity=".22"/>${rects}${tick}</g></svg>`
  )
}

// Lucide chevron-up (fold) / chevron-down (open), as plan-progress draws its fold control: the picture centred in
// its cell and a blank Button over it, so the host draws its own hover and focus ring and takes the press.
const CHIP = 16
const chevronSvg = (isCollapsed: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CHIP}" height="${CHIP}" viewBox="0 0 24 24"><style>.c{stroke:#C2C0B6}` +
  `@media (prefers-color-scheme:light){.c{stroke:#3D3D3A}}</style>` +
  `<path class="c" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="${isCollapsed ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'}"/></svg>`

const altOf = (bar: Bar) => bar.parts.map(s => `${Math.round((s.to - s.from) * 100)}%`).join(', ') || 'empty'

export function renderDesktop(E: DeskEls, vm: ViewModel, columns: number, actions: Actions, isCollapsed: boolean): RenderElement {
  const { Box, Button, Svg } = E
  const painter: Painter = {
    bar: (key, bar, n) => {
      const width = n * PX_PER_CELL
      return (
        <Box key={key} width={n} flexShrink={0} alignItems="center">
          <Svg source={barSvg(bar, width)} alt={altOf(bar)} width={width} height={BAR_H} />
        </Box>
      )
    },
    chevron: (folded, onPress) => (
      <Box key="collapse-cell" width={3} height={1} flexShrink={0} justifyContent="center" alignItems="center">
        <Svg source={chevronSvg(folded)} alt={folded ? 'expand the panel' : 'collapse the panel'} width={CHIP} height={CHIP} />
        <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
          <Button key="collapse" plain label={'  '} onPress={onPress} />
        </Box>
      </Box>
    ),
  }
  return panel(E, painter, vm, Math.max(30, columns), actions, isCollapsed)
}
