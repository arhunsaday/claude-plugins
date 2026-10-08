// The desktop/editor/phone panel, drawn as SVG at real pixel sizes: the
// context bar and legend, a ring per limit and one for the cache, the notice.
// No card or background: text and tracks take the light or dark theme through
// prefers-color-scheme, data colours read on both. The host draws the buttons.
// Adapted from Christandoh/context-cache's design (MIT).

import { ellipsize, textWidth } from './metrics'
import { fmtTokens, pct, type CacheView, type LimitView, type Tone, type ViewModel } from './model'

const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`
const NS = 'http://www.w3.org/2000/svg'

/** The design's own width; wider bands leave the rest of the row empty rather than spreading the rings apart. */
export const MAX_WIDTH = 520

const HEX: Record<Tone, string> = {
  claude: '#E8833A',
  suggestion: '#3B7BE0',
  merged: '#8A6FC0',
  inactive: '#7D7970',
  success: '#4FAE6A',
  warning: '#E0A84F',
  error: '#E5604F',
}

// t1…t4: text from strongest to faintest; tr: tracks; tk: ticks. Dark first, light under the media query.
const STYLE =
  `<style>` +
  `.t1{fill:#ECE9E2}.t2{fill:#B9B5AB}.t3{fill:#8A867D}.t4{fill:#7D7970}.tr{fill:#3A3835}.trs{stroke:#3A3835}.tk{fill:#ECE9E2}.tks{stroke:#ECE9E2}` +
  `@media (prefers-color-scheme:light){` +
  `.t1{fill:#1F1E1D}.t2{fill:#3D3D3A}.t3{fill:#6B6A65}.t4{fill:#8A8983}.tr{fill:#E3E1DA}.trs{stroke:#E3E1DA}.tk{fill:#3D3D3A}.tks{stroke:#3D3D3A}}` +
  `</style>`

const DIM = 0.38
const SLACK = 1.1
const ROW_GAP = 11
const LH = (size: number) => Math.round(size * 1.25)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const r2 = (n: number) => Math.round(n * 100) / 100
/** Baseline of a line of `size` px whose box starts at `top`. */
const base = (top: number, size: number) => r2(top + LH(size) / 2 + size * 0.35)

type Run = { text: string; cls?: string; fill?: string; bold?: boolean }

function text(x: number, top: number, size: number, runs: Run[], anchor: 'start' | 'end' = 'start'): string {
  const spans = runs
    .map(r => `<tspan${r.cls ? ` class="${r.cls}"` : ''}${r.fill ? ` fill="${r.fill}"` : ''}${r.bold ? ' font-weight="700"' : ''}>${esc(r.text)}</tspan>`)
    .join('')
  return `<text x="${r2(x)}" y="${base(top, size)}" font-size="${size}" text-anchor="${anchor}" xml:space="preserve">${spans}</text>`
}

function doc(width: number, height: number, body: string, alt: string): string {
  return (
    `<svg xmlns="${NS}" width="${r2(width)}" height="${r2(height)}" viewBox="0 0 ${r2(width)} ${r2(height)}" ` +
    `font-family="${FONT}" role="img" aria-label="${esc(alt)}">${STYLE}${body}</svg>`
  )
}

// ── Bars and rings ─────────────────────────────────────────────────────────

/** The context bar: a rounded track, a run per group with 1px between, the auto-compact tick. */
function contextBar(id: string, ctx: NonNullable<ViewModel['context']>, x: number, y: number, w: number, h: number): string {
  let inner = ''
  let at = x
  for (const s of ctx.segments) {
    const sw = (s.tokens / ctx.window) * w
    if (s.tokens > 0) inner += `<rect x="${r2(at)}" y="${r2(y)}" width="${r2(sw)}" height="${h}" fill="${HEX[s.color]}"/>`
    at += sw + (s.tokens > 0 ? 1 : 0)
  }
  if (ctx.compactPct !== null) inner += `<rect class="tk" x="${r2(x + (ctx.compactPct / 100) * w - 1)}" y="${r2(y)}" width="2" height="${h}"/>`
  return (
    `<clipPath id="${id}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${h}" rx="${h / 2}"/></clipPath>` +
    `<g clip-path="url(#${id})"><rect class="tr" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${h}"/>${inner}</g>`
  )
}

type IconName = 'clock' | 'calendar' | 'fable' | 'flame' | 'snow' | 'empty'

/** 24-unit icons: session clock, weekly calendar, Fable sparkle, cache flame / snowflake / empty. */
function icon(name: IconName, color: string): string {
  const s = `fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`
  switch (name) {
    case 'clock':
      return `<circle cx="12" cy="12" r="9" ${s}/><path d="M12 7v5l3.5 2" ${s}/>`
    case 'calendar':
      return `<rect x="3.5" y="5" width="17" height="15" rx="2.5" ${s}/><path d="M3.5 10h17M8.5 3v4M15.5 3v4" ${s}/>`
    case 'fable':
      return `<path d="M12 2.5l2.2 6.6 6.8 2.4-6.8 2.4L12 20.5l-2.2-6.6L3 11.5l6.8-2.4z" fill="${color}"/>`
    case 'flame':
      return `<path d="M12 2.5c.8 3.4 5 5.6 5 10.5a5 5 0 0 1-10 0c0-2.6 1.4-4 2.6-5.2.2 2 1 3.2 2.4 3.6-.6-3.2-.8-6.2 0-8.9z" fill="${color}"/>`
    case 'snow':
      return `<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8" ${s}/>`
    case 'empty':
      return `<circle cx="12" cy="12" r="7" ${s}/>`
  }
}

/** An arc of radius r from deg a to deg b, clockwise from 12 o'clock. */
function arc(cx: number, cy: number, r: number, width: number, a: number, b: number, paint: string): string {
  if (b - a <= 0) return ''
  if (b - a >= 359.99) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${width}" ${paint}/>`
  const p = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${r2(cx + r * Math.cos(rad))} ${r2(cy + r * Math.sin(rad))}`
  }
  return `<path d="M${p(a)} A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${p(b)}" fill="none" stroke-width="${width}" ${paint}/>`
}

type RingData = { usage: number | null; time: number | null; color: string; icon: IconName }

/** A ring: faint to the larger of usage and time, bright to usage, a notch at time; the icon inside. */
function ring(cx: number, cy: number, size: 'full' | 'mini', d: RingData): string {
  const r = size === 'full' ? 13 : 6.5
  const w = size === 'full' ? 4 : 2.5
  let s = `<circle class="trs" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${w}"/>`
  if (d.usage !== null) {
    const u = d.usage * 3.6
    const t = (d.time ?? 0) * 3.6
    s += arc(cx, cy, r, w, 0, Math.max(u, t), `stroke="${d.color}" stroke-opacity="${DIM}"`)
    s += arc(cx, cy, r, w, 0, u, `stroke="${d.color}"`)
    if (d.time !== null && size === 'full') s += arc(cx, cy, r, w, Math.max(0, t - 2), Math.min(360, t + 2), 'class="tks"')
  }
  if (size === 'full') s += `<g transform="translate(${cx - 6} ${cy - 6}) scale(0.5)">${icon(d.icon, d.color)}</g>`
  return s
}

const LIMIT_ICON = { session: 'clock', weekly: 'calendar', fable: 'fable' } as const
const cacheIcon = (c: CacheView): IconName => (c.state === 'cold' ? 'snow' : c.state === 'empty' ? 'empty' : 'flame')

const limitRing = (l: LimitView): RingData => ({ usage: l.usage, time: l.time, color: HEX[l.color], icon: LIMIT_ICON[l.kind] })
const cacheRing = (c: CacheView): RingData => ({
  usage: c.state === 'empty' ? null : c.warmth * 100,
  time: null,
  color: HEX[c.color],
  icon: cacheIcon(c),
})

function limitTitle(l: LimitView): string {
  if (l.usage === null) return `${l.title}: no data`
  const time = l.time === null ? '' : `, ${pct(l.time)}% of the window gone`
  return `${l.title}: ${pct(l.usage)}% used${time}. ${l.reset}.`
}

function cacheTitle(c: CacheView): string {
  const hit = c.hit === null ? '' : ` Last hit rate ${pct(c.hit)}%.`
  return `Prompt cache: ${c.label}, ${c.detail.toLowerCase()}.${hit}`
}

// ── The panel ──────────────────────────────────────────────────────────────

export type PanelSvg = { svg: string; width: number; height: number; alt: string }

function altOf(vm: ViewModel): string {
  const ctx = vm.context
  return [
    ctx ? `Context ${fmtTokens(ctx.used)} of ${fmtTokens(ctx.window)} (${ctx.usedPct}%)` : 'Context: no reading',
    ...vm.limits.map(limitTitle),
    cacheTitle(vm.cache),
    vm.notice,
  ].join(' ')
}

/** The expanded panel at `width` px (capped at MAX_WIDTH). */
export function panelSvg(vm: ViewModel, width: number, idPrefix = 'cc'): PanelSvg {
  const W = Math.max(240, Math.min(MAX_WIDTH, width))
  const narrow = W < 360
  let y = 2
  let out = ''

  // Row 1: Context, used, the bar, where auto-compact fires.
  const ctx = vm.context
  if (ctx) {
    const top = y
    let x = 0
    out += text(x, top, 13, [{ text: 'Context', cls: 't1', bold: true }])
    x += textWidth('Context', 13, true) + 10
    const used = `${fmtTokens(ctx.used)} / ${fmtTokens(ctx.window)} (${ctx.usedPct}%)`
    out += text(x, top + 0.5, 12.5, [{ text: used, cls: 't3' }])
    x += textWidth(used, 12.5) + 10
    const right = ctx.compactPct === null ? '' : narrow ? `${ctx.compactPct}%` : `compacts at ${ctx.compactPct}%`
    const barEnd = right ? W - textWidth(right, 12.5) - 10 : W
    if (right) out += text(W, top + 0.5, 12.5, [{ text: right, cls: 't4' }], 'end')
    out += contextBar(`${idPrefix}c`, ctx, x, top + LH(13) / 2 - 4, Math.max(40, barEnd - x), 8)
  } else {
    out += text(0, y, 12.5, [{ text: 'Context: waiting for the first reading', cls: 't4' }])
  }
  y += LH(13) + ROW_GAP

  // Row 2: the legend, wrapping between items.
  if (ctx && !narrow) {
    const items: Run[][] = ctx.segments.map(s => [
      { text: '●', fill: HEX[s.color] },
      { text: ` ${s.label} ${fmtTokens(s.tokens)}`, cls: 't2' },
    ])
    items.push([{ text: `Free ${fmtTokens(ctx.free)}`, cls: 't4' }])
    const widthOf = (it: Run[]) => it.reduce((w, r) => w + textWidth(r.text, 11.5), 0)
    let x = 0
    for (const it of items) {
      const w = widthOf(it)
      if (x > 0 && x + w > W) {
        x = 0
        y += LH(11.5) + 4
      }
      out += text(x, y, 11.5, it)
      x += w + 12
    }
    y += LH(11.5) + ROW_GAP
  }

  // Row 3: a ring per limit and one for the cache, spread across the row; each says more on hover.
  const c = vm.cache
  const items = [
    ...vm.limits.map(l => ({
      ring: limitRing(l),
      main: { text: l.usage === null ? '—' : `${pct(l.usage)}%`, cls: l.usage === null ? 't4' : 't1' } as Run,
      sub: l.time === null ? (l.usage === null ? 'No data' : '') : `Time ${pct(l.time)}%`,
      title: limitTitle(l),
    })),
    {
      ring: cacheRing(c),
      main: { text: c.label, fill: HEX[c.color] } as Run,
      sub: c.state === 'empty' ? 'Nothing cached' : `${pct(c.warmth * 100)}% warm`,
      title: cacheTitle(c),
    },
  ]
  const twoLines = !narrow
  // Measured with a little slack: the host's font can run wider than these metrics.
  const widths = items.map(it => 30 + 6 + SLACK * Math.max(textWidth(it.main.text, 13, true), twoLines ? textWidth(it.sub, 10.5) : 0))
  const step = Math.max(8, (W - widths.reduce((a, b) => a + b, 0)) / (items.length - 1))
  const textH = twoLines ? LH(13) + LH(10.5) : LH(13)
  const rowH = Math.max(30, textH)
  let x = 0
  items.forEach((it, i) => {
    const ty = y + (rowH - textH) / 2
    out +=
      `<g><title>${esc(it.title)}</title>` +
      `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(widths[i] ?? 0)}" height="${rowH}" fill="transparent"/>` +
      ring(x + 15, y + rowH / 2, 'full', it.ring) +
      text(x + 36, ty, 13, [{ ...it.main, bold: true }]) +
      (twoLines ? text(x + 36, ty + LH(13), 10.5, [{ text: it.sub, cls: 't3' }]) : '') +
      `</g>`
    x += (widths[i] ?? 0) + step
  })
  y += rowH + ROW_GAP

  // Row 4: the notice, wrapped under a dot in the cache's colour.
  if (vm.showNotice) {
    const maxW = W - 15
    const words = vm.notice.split(/(?<=\s)/)
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      if (cur && textWidth((cur + w).trimEnd(), 12.5) > maxW) {
        lines.push(cur.trimEnd())
        cur = w
      } else cur += w
    }
    if (cur.trim()) lines.push(cur.trimEnd())
    out += `<circle cx="3.5" cy="${r2(y + LH(12.5) / 2)}" r="3.5" fill="${HEX[c.color]}"/>`
    lines.forEach((t, i) => {
      out += text(15, y + i * LH(12.5), 12.5, [{ text: ellipsize(t, 12.5, maxW), cls: 't2' }])
    })
    y += lines.length * LH(12.5)
  } else {
    y -= ROW_GAP
  }

  const height = Math.ceil(y + 2)
  const alt = altOf(vm)
  return { svg: doc(W, height, out, alt), width: W, height, alt }
}

/** The collapsed panel: one line of context and a mini ring per limit and for the cache. */
export function collapsedSvg(vm: ViewModel, width: number, idPrefix = 'cl'): PanelSvg {
  const W = Math.max(200, Math.min(MAX_WIDTH, width))
  const H = 20
  const mid = H / 2
  const top = (H - LH(12.5)) / 2
  const ctx = vm.context
  const c = vm.cache
  const parts: { w: number; svg: (x: number) => string }[] = []

  const ctxRuns: Run[] = [
    { text: 'Context ', cls: 't1', bold: true },
    { text: ctx ? `${ctx.usedPct}%` : '—', cls: 't2' },
  ]
  const ctxW = textWidth('Context ', 12.5, true) + textWidth(ctxRuns[1]!.text, 12.5)
  parts.push({ w: ctxW, svg: x => text(x, top, 12.5, ctxRuns) })
  if (ctx && W >= 380) parts.push({ w: 64, svg: x => contextBar(`${idPrefix}c`, ctx, x, mid - 3, 64, 6) })

  const ringItem = (d: RingData, label: Run, title: string) => {
    const w = 16 + 5 + textWidth(label.text, 12.5, true)
    parts.push({
      w,
      svg: x =>
        `<g><title>${esc(title)}</title><rect x="${r2(x)}" y="0" width="${r2(w)}" height="${H}" fill="transparent"/>` +
        ring(x + 8, mid, 'mini', d) +
        text(x + 21, top, 12.5, [{ ...label, bold: true }]) +
        `</g>`,
    })
  }
  for (const l of vm.limits) {
    ringItem(limitRing(l), { text: l.usage === null ? '—' : `${pct(l.usage)}%`, cls: l.usage === null ? 't4' : 't1' }, limitTitle(l))
  }
  const cacheText = c.state === 'warm' || c.state === 'cooling' ? `${c.label} ${c.detail.split(' of ')[0]}` : c.label
  ringItem(cacheRing(c), { text: cacheText, fill: HEX[c.color] }, cacheTitle(c))

  const GAP = 16
  let out = ''
  let x = 0
  for (const p of parts) {
    if (x + p.w > W) break
    out += p.svg(x)
    x += p.w + GAP
  }
  const used = Math.ceil(x - GAP)
  return { svg: doc(used, H, out, altOf(vm)), width: used, height: H, alt: altOf(vm) }
}
