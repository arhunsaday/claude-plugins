// Drawing for the cache-warm band. One layout on every surface: text rows in
// the theme's colours; the warmth bar is text on the terminal and a thin SVG
// on the desktop, where box-drawing glyphs do not join up.

import type { Elements, RenderElement } from 'claude-code'

import { detailsOf, fmtSpan, fmtTokens, pct, sparkOf, type Tone, type ViewModel } from './model'

export type Actions = {
  ping: () => void | Promise<void>
  auto: () => void | Promise<void>
  /** Folds the band to one line or opens it again. */
  toggle: () => void | Promise<void>
}

type TermEls = Elements['terminal']
type DeskEls = Elements['desktop'] | Elements['vscode']

const MAX_COLUMNS = 72
const LABEL_W = 11
const PX_PER_CELL = 8
const MAX_PX = 520

// ── Shared rows ────────────────────────────────────────────────────────────

const isLive = (vm: ViewModel) => vm.state === 'warm' || vm.state === 'cooling'

/** The header's leading mark: the state glyph, or in the folded row the warmth ring. */
function header(E: TermEls, vm: ViewModel, chevron: RenderElement | null, tail: RenderElement | null, lead?: RenderElement) {
  const { Box, Text } = E
  return (
    <Box key="header" flexDirection="row" columnGap={1} alignItems="center">
      {lead ?? <Text color={vm.tone}>{vm.isPinging ? '↻' : vm.glyph}</Text>}
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate">
          <Text bold>Cache</Text>
          <Text dimColor> · </Text>
          <Text color={vm.tone}>{vm.isPinging ? 'Warming' : vm.label}</Text>
          <Text dimColor>{` · ${vm.detail}${vm.isTtlKnown || !isLive(vm) ? '' : ' (assumed)'}`}</Text>
        </Text>
      </Box>
      {tail}
      <Box flexGrow={1} />
      {chevron}
    </Box>
  )
}

function stats(E: TermEls, vm: ViewModel, sparkCells: number) {
  const { Box, Text } = E
  const sep = <Text dimColor> · </Text>
  const row = (key: string, label: string, content: RenderElement) => (
    <Box key={key} flexDirection="row">
      <Box width={LABEL_W} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate">{content}</Text>
      </Box>
    </Box>
  )

  const last = vm.last ? (
    <Text>
      <Text bold>{vm.lastHit === null ? '—' : pct(vm.lastHit)}</Text>
      <Text> hit</Text>
      {sep}
      <Text>{`${fmtTokens(vm.last.read)} read`}</Text>
      {sep}
      <Text>{`${fmtTokens(vm.last.written)} written`}</Text>
      {vm.last.uncached > 0 ? sep : null}
      {vm.last.uncached > 0 ? <Text dimColor>{`${fmtTokens(vm.last.uncached)} uncached`}</Text> : null}
    </Text>
  ) : (
    <Text dimColor>no reply yet</Text>
  )

  const saved: Tone = vm.saved !== null && vm.saved < 0 ? 'error' : 'success'
  const session = (
    <Text>
      <Text bold>{vm.sessionHit === null ? '—' : pct(vm.sessionHit)}</Text>
      <Text> hit</Text>
      {sep}
      <Text>{`${fmtTokens(vm.totals.read)} read`}</Text>
      {vm.saved === null ? null : sep}
      {vm.saved === null ? null : (
        <Text color={saved}>{vm.saved < 0 ? `input +${pct(-vm.saved)}` : `input −${pct(vm.saved)}`}</Text>
      )}
      {vm.lapses > 0 ? sep : null}
      {vm.lapses > 0 ? <Text color="warning">{vm.lapses === 1 ? '1 lapse' : `${vm.lapses} lapses`}</Text> : null}
    </Text>
  )

  const spark = sparkOf(vm.replies, sparkCells)
  const history = spark.length ? (
    <Text>
      {spark.map(s => (
        <Text color={s.tone} dimColor={s.isDim}>
          {s.ch}
        </Text>
      ))}
    </Text>
  ) : (
    <Text dimColor>—</Text>
  )

  const keep = (
    <Text>
      <Text color={vm.isAuto ? 'success' : undefined} dimColor={!vm.isAuto}>
        {vm.isAuto ? 'auto' : 'off'}
      </Text>
      {vm.isPinging ? sep : null}
      {vm.isPinging ? <Text color={vm.tone}>pinging…</Text> : null}
      {!vm.isPinging && vm.nextPingMs !== null ? sep : null}
      {!vm.isPinging && vm.nextPingMs !== null ? <Text dimColor>{`next ping in ${fmtSpan(vm.nextPingMs)}`}</Text> : null}
      {vm.pings > 0 ? sep : null}
      {vm.pings > 0 ? <Text dimColor>{`${vm.pings} ${vm.pings === 1 ? 'ping' : 'pings'}, ${fmtTokens(vm.pingRead)} re-read`}</Text> : null}
    </Text>
  )

  return [
    row('last', 'Last reply', last),
    row('session', 'Session', session),
    row('history', 'History', history),
    row('keep', 'Keep-warm', keep),
  ]
}

function actionsRow(E: TermEls, vm: ViewModel, actions: Actions) {
  const { Box, Text, Button } = E
  return (
    <Box key="actions" flexDirection="column">
      {vm.notice ? (
        <Text wrap="wrap">
          <Text color={vm.tone}>● </Text>
          <Text>{vm.notice}</Text>
        </Text>
      ) : null}
      <Box flexDirection="row" columnGap={1}>
        {isLive(vm) ? (
          <Button key="ping" label={vm.isPinging ? 'Warming…' : 'Keep warm'} variant="primary" hotkey="w" onPress={actions.ping} />
        ) : null}
        <Button key="auto" label={vm.isAuto ? 'Auto on' : 'Auto off'} hotkey="a" dimColor={!vm.isAuto} onPress={actions.auto} />
      </Box>
    </Box>
  )
}

// ── Terminal ───────────────────────────────────────────────────────────────

function barText(E: TermEls, vm: ViewModel, n: number) {
  const { Text } = E
  const filled = Math.max(vm.warmth > 0 ? 1 : 0, Math.round(vm.warmth * n))
  return (
    <Text key="bar">
      <Text color={vm.tone}>{'━'.repeat(filled)}</Text>
      <Text dimColor>{'─'.repeat(Math.max(0, n - filled))}</Text>
    </Text>
  )
}

/** The folded row's ring on the terminal: a circle that empties a quarter at a time as the cache cools. */
export function ringGlyph(vm: ViewModel): string {
  if (vm.isPinging) return '↻'
  if (vm.warmth <= 0) return '○'
  return vm.warmth > 0.875 ? '●' : vm.warmth > 0.625 ? '◕' : vm.warmth > 0.375 ? '◑' : '◔'
}

function hitTail(E: TermEls, vm: ViewModel) {
  const { Text } = E
  return vm.state === 'empty' || vm.lastHit === null ? null : <Text dimColor>{`${pct(vm.lastHit)} hit`}</Text>
}

export function renderTerminal(E: TermEls, vm: ViewModel, columns: number, actions: Actions, isCollapsed: boolean): RenderElement {
  const { Box, Text, Button } = E
  const cols = Math.max(24, Math.min(MAX_COLUMNS, columns))
  const chevron = <Button key="collapse" plain dimColor label={isCollapsed ? '▸' : '▾'} onPress={actions.toggle} />

  if (isCollapsed || vm.state === 'empty') {
    const ring = (
      <Text key="ring" color={vm.tone}>
        {ringGlyph(vm)}
      </Text>
    )
    return (
      <Box key="cache-warm" flexDirection="column" width={cols}>
        {header(E, vm, vm.state === 'empty' ? null : chevron, hitTail(E, vm), ring)}
      </Box>
    )
  }

  return (
    <Box key="cache-warm" flexDirection="column" rowGap={1} width={cols}>
      <Box flexDirection="column">
        {header(E, vm, chevron, null)}
        {barText(E, vm, cols)}
        {stats(E, vm, cols - LABEL_W)}
      </Box>
      {actionsRow(E, vm, actions)}
    </Box>
  )
}

// ── Desktop, editor ────────────────────────────────────────────────────────

// [light, dark] for each tone the bar takes, close to the hosts' own theme colours.
const HEX: Record<Tone, [string, string]> = {
  claude: ['#C15F3C', '#D97757'],
  warning: ['#966C1E', '#FFC107'],
  suggestion: ['#5769F7', '#B1B9F9'],
  inactive: ['#87867F', '#87867F'],
  success: ['#2C7A39', '#4EBA65'],
  error: ['#AB2B3F', '#FF6B80'],
  merged: ['#8250DF', '#AF87FF'],
}

export function barSvg(warmth: number, tone: Tone, width: number): string {
  const h = 6
  const fill = warmth > 0 ? Math.max(h, Math.round(warmth * width)) : 0
  const [light, dark] = HEX[tone]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">` +
    `<style>.t{fill:#3D3D3A}.f{fill:${dark}}@media (prefers-color-scheme:light){.t{fill:#E8E6DC}.f{fill:${light}}}</style>` +
    `<rect class="t" width="${width}" height="${h}" rx="3"/>` +
    (fill > 0 ? `<rect class="f" width="${fill}" height="${h}" rx="3"/>` : '') +
    `</svg>`
  )
}

const RING = 16
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The folded row's ring on the desktop: a track, the warmth drawn clockwise from 12 o'clock, the details as its hover title. */
export function ringSvg(warmth: number, tone: Tone, title: string): string {
  const c = RING / 2
  const w = 2.5
  const r = c - w / 2 - 0.5
  const [light, dark] = HEX[tone]
  const deg = Math.max(0, Math.min(1, warmth)) * 360
  const at = (a: number) => {
    const rad = ((a - 90) * Math.PI) / 180
    return `${(c + r * Math.cos(rad)).toFixed(2)} ${(c + r * Math.sin(rad)).toFixed(2)}`
  }
  const fill =
    deg <= 0
      ? ''
      : deg >= 359.99
        ? `<circle class="f" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${w}"/>`
        : `<path class="f" d="M${at(0)} A${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${at(deg)}" fill="none" stroke-width="${w}" stroke-linecap="round"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RING}" height="${RING}" viewBox="0 0 ${RING} ${RING}">` +
    `<style>.t{stroke:#3D3D3A}.f{stroke:${dark}}@media (prefers-color-scheme:light){.t{stroke:#E8E6DC}.f{stroke:${light}}}</style>` +
    `<title>${esc(title)}</title>` +
    `<rect width="${RING}" height="${RING}" fill="transparent"/>` +
    `<circle class="t" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${w}"/>${fill}</svg>`
  )
}

// Lucide chevron-up (fold) / chevron-down (open), drawn as plan-progress and context-cache draw theirs: the picture
// centred in its cell and a blank Button over it, so the host draws its own hover and focus ring and takes the press.
const CHIP = 16
const chevronSvg = (isCollapsed: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CHIP}" height="${CHIP}" viewBox="0 0 24 24"><style>.c{stroke:#C2C0B6}` +
  `@media (prefers-color-scheme:light){.c{stroke:#3D3D3A}}</style>` +
  `<path class="c" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="${isCollapsed ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'}"/></svg>`

export function renderDesktop(E: DeskEls, vm: ViewModel, columns: number, actions: Actions, isCollapsed: boolean): RenderElement {
  const T = E as unknown as TermEls
  const { Box, Button, Svg } = E
  const px = Math.max(120, Math.min(MAX_PX, columns * PX_PER_CELL - 32))
  const chevron = (
    <Box key="collapse-cell" width={3} height={1} flexShrink={0} justifyContent="center" alignItems="center">
      <Svg source={chevronSvg(isCollapsed)} alt={isCollapsed ? 'expand the cache band' : 'collapse the cache band'} width={CHIP} height={CHIP} />
      <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
        <Button key="collapse" plain label={'  '} onPress={actions.toggle} />
      </Box>
    </Box>
  )
  const bar = (key: string, width: number) => (
    <Svg key={key} source={barSvg(vm.warmth, vm.tone, width)} alt={`cache ${pct(vm.warmth)} warm`} width={width} height={6} />
  )

  if (isCollapsed || vm.state === 'empty') {
    const details = detailsOf(vm)
    const ring = (
      <Box key="ring-cell" width={2} height={1} flexShrink={0} justifyContent="center" alignItems="center">
        <Svg key="ring" source={ringSvg(vm.warmth, vm.tone, details)} alt={details} width={RING} height={RING} isInteractive />
      </Box>
    )
    return (
      <Box key="cache-warm" flexDirection="column">
        {header(T, vm, vm.state === 'empty' ? null : chevron, hitTail(T, vm), ring)}
      </Box>
    )
  }

  return (
    <Box key="cache-warm" flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        {header(T, vm, chevron, null)}
        <Box flexDirection="row" alignItems="center" height={1}>
          {bar('bar', px)}
        </Box>
        {stats(T, vm, Math.floor(px / PX_PER_CELL) - LABEL_W)}
      </Box>
      {actionsRow(T, vm, actions)}
    </Box>
  )
}

// ── The prompt footer, beside the model picker and the usage rings ─────────

/** The terminal's dim mode label outside fullscreen: the ring glyph and the time left. */
export function modeLabel(vm: ViewModel): string {
  const left = vm.state === 'warm' || vm.state === 'cooling' ? fmtSpan(vm.remainingMs) : vm.state === 'cold' ? 'cold' : 'empty'
  return `${ringGlyph(vm)} cache ${left}`
}

export function footerRingTerminal(E: TermEls, vm: ViewModel): RenderElement {
  const { Text } = E
  return (
    <Text key="footer-ring" color={vm.tone}>
      {ringGlyph(vm)}
    </Text>
  )
}

export function footerRingDesktop(E: DeskEls, vm: ViewModel): RenderElement {
  const { Svg } = E
  const details = detailsOf(vm)
  return <Svg key="footer-ring" source={ringSvg(vm.warmth, vm.tone, details)} alt={details} width={RING} height={RING} isInteractive />
}
