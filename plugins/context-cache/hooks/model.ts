// Pure maths and copy for the context-cache panel: no `$`, no drawing.
// Everything here takes real figures in and returns what the panel shows.

import type { ContextCategory, SessionMessage, SessionRateLimit } from 'claude-code'

import type {
  ContextCacheCache,
  ContextCacheContext,
  ContextCacheGroup,
  ContextCacheLimit,
  ContextCacheLimitKind,
  ContextCacheSnapshot,
} from '../types'

// ── Colours ────────────────────────────────────────────────────────────────

// Theme keys, so the panel takes the person's Claude Code theme on every surface.
export type Tone = 'claude' | 'suggestion' | 'merged' | 'inactive' | 'success' | 'warning' | 'error'

export const GROUP_COLORS: Record<ContextCacheGroup, Tone> = {
  system: 'inactive',
  tools: 'merged',
  files: 'suggestion',
  messages: 'claude',
}

export const GROUP_LABELS: Record<ContextCacheGroup, string> = {
  system: 'System',
  tools: 'Tools',
  files: 'Files',
  messages: 'Messages',
}

export const GROUPS: readonly ContextCacheGroup[] = ['system', 'tools', 'files', 'messages']

export const LIMIT_TITLES: Record<ContextCacheLimitKind, string> = {
  session: 'Session',
  weekly: 'Weekly',
  fable: 'Fable',
}

export const CACHE_COLORS: Record<CacheState, Tone> = {
  warm: 'claude',
  cooling: 'warning',
  cold: 'suggestion',
  empty: 'inactive',
}

export const HOUR = 3_600_000
export const FIVE_HOURS = 5 * HOUR
export const SEVEN_DAYS = 7 * 24 * HOUR
export const TTL_5M = 5 * 60_000
export const TTL_1H = HOUR

// ── Formatting ─────────────────────────────────────────────────────────────

/** 452000 → "452k", 1000000 → "1M", 1500000 → "1.5M", 640 → "640". */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.max(0, Math.round(n)))
}

/** Whole percent, never NaN. */
export function pct(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** 7_920_000 → "2h 12m"; 200_000 → "3m 20s"; 45_000 → "45s"; days when ≥ 24h. */
export function fmtSpan(ms: number, withSeconds = false): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (withSeconds) return m > 0 ? `${m}m ${sec}s` : `${sec}s`
  return `${m}m`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Resets in 2h 12m" inside a day, else "Resets Sun 11:00 pm" (local time). */
export function fmtReset(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return 'Reset time not reported'
  const left = resetsAt - now
  if (left <= 0) return 'Resetting now'
  if (left < 24 * HOUR) return `Resets in ${fmtSpan(left)}`
  const d = new Date(resetsAt)
  const h24 = d.getHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `Resets ${DAYS[d.getDay()]} ${h12}:${mm} ${h24 < 12 ? 'am' : 'pm'}`
}

// ── Context ────────────────────────────────────────────────────────────────

/** Tools whose results are file contents, for the Files share of Messages. */
const FILE_TOOLS = new Set(['Read', 'NotebookRead'])

/**
 * The share of the conversation's text that is file contents the model read,
 * 0 to 1: the Files segment is that share of the Messages row's real tokens.
 */
export function fileShareOf(messages: readonly SessionMessage[]): number {
  let total = 0
  let files = 0
  for (const m of messages) {
    total += m.text.length
    for (const use of m.toolUses) {
      const len = (use.text ?? '').length + JSON.stringify(use.input ?? {}).length
      total += len
      if (FILE_TOOLS.has(use.tool)) files += (use.text ?? '').length
    }
  }
  return total > 0 ? Math.min(1, files / total) : 0
}

/** Which of the four groups a /context row belongs to. */
export function groupOf(name: string): ContextCacheGroup {
  if (/message/i.test(name)) return 'messages'
  if (/tool|mcp|agent|skill|command/i.test(name)) return 'tools'
  return 'system'
}

/**
 * The context row's figures: /context's categories grouped into four and
 * scaled so they sum to the real token count the last response reported.
 */
export function buildContext(args: {
  categories: readonly ContextCategory[]
  realTokens: number | undefined
  window: number
  autoCompactAt: number | undefined
  isAutoCompactEnabled: boolean
  fileShare: number
}): ContextCacheContext {
  const raw: Record<ContextCacheGroup, number> = { system: 0, tools: 0, files: 0, messages: 0 }
  for (const c of args.categories) {
    if (c.kind !== 'used') continue
    raw[groupOf(c.name)] += c.tokens
  }
  const fileTokens = Math.round(raw.messages * args.fileShare)
  raw.files = fileTokens
  raw.messages -= fileTokens
  const estimate = GROUPS.reduce((s, g) => s + raw[g], 0)
  const used = args.realTokens ?? estimate
  const k = estimate > 0 ? used / estimate : 0
  const parts = { system: 0, tools: 0, files: 0, messages: 0 } as Record<ContextCacheGroup, number>
  for (const g of GROUPS) parts[g] = Math.round(raw[g] * k)
  return {
    used,
    window: args.window,
    autoCompactAt: args.isAutoCompactEnabled && args.autoCompactAt ? args.autoCompactAt : null,
    parts,
  }
}

// ── Limits ─────────────────────────────────────────────────────────────────

type Found = { path: string[]; node: Record<string, unknown>; usage: number }

function walk(node: unknown, path: string[], out: Found[]): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => walk(n, [...path, String(i)], out))
    return
  }
  if (node === null || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  // five_hour / seven_day say `utilization`; the limits[] items (the per-model windows) say `percent`.
  const u = obj['utilization'] ?? obj['percent'] ?? obj['percent_used'] ?? obj['used_percent']
  if (typeof u === 'number') {
    out.push({ path, node: obj, usage: u })
    return
  }
  for (const [k, v] of Object.entries(obj)) walk(v, [...path, k], out)
}

const isFable = (f: Found) => /fable/i.test(f.path.join('.')) || /fable/i.test(JSON.stringify(f.node))

/** Every window with a utilization figure in the account usage JSON, for /cache status. */
export function usageWindowsOf(json: unknown): { path: string; usage: number; isFable: boolean }[] {
  const found: Found[] = []
  walk(json, [], found)
  return found.map(f => ({ path: f.path.join('.'), usage: f.usage, isFable: isFable(f) }))
}

function toEpochMs(v: unknown): number | null {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/**
 * Reads the account usage endpoint's JSON (api.anthropic.com/api/oauth/usage),
 * the same source /usage draws on: `five_hour` is the current session,
 * `seven_day` the weekly limit, and Fable is the `limits[]` item of kind
 * `weekly_scoped` whose `scope.model.display_name` is "Fable" (an item with
 * `scope: null` repeats `seven_day`). Matching by name rather than a fixed
 * key keeps it working if the key moves.
 */
export function parseAccountUsage(json: unknown): ContextCacheLimit[] {
  const found: Found[] = []
  walk(json, [], found)
  const out: ContextCacheLimit[] = []
  const take = (kind: ContextCacheLimitKind, f: Found | undefined, windowMs: number) => {
    if (!f) return
    out.push({
      kind,
      usage: Math.max(0, Math.min(100, f.usage)),
      resetsAt: toEpochMs(f.node['resets_at'] ?? f.node['resetsAt']),
      windowMs,
    })
  }
  const keyOf = (f: Found) => f.path[f.path.length - 1] ?? ''
  take('session', found.find(f => keyOf(f) === 'five_hour'), FIVE_HOURS)
  take('weekly', found.find(f => keyOf(f) === 'seven_day'), SEVEN_DAYS)
  const fable = found.filter(isFable).sort((a, b) => b.usage - a.usage)[0]
  take('fable', fable, SEVEN_DAYS)
  return out
}

/** The engine's own per-response rate-limit readings, as a fallback. */
export function limitsFromResponse(rateLimits: readonly SessionRateLimit[]): ContextCacheLimit[] {
  const out: ContextCacheLimit[] = []
  for (const r of rateLimits) {
    const kind: ContextCacheLimitKind | null =
      r.kind === 'five_hour' ? 'session' : r.kind === 'seven_day' ? 'weekly' : /fable/i.test(r.kind) ? 'fable' : null
    if (!kind) continue
    out.push({
      kind,
      usage: Math.max(0, Math.min(100, r.percentUsed)),
      resetsAt: r.resetsAt ? toEpochMs(r.resetsAt) : null,
      windowMs: kind === 'session' ? FIVE_HOURS : SEVEN_DAYS,
    })
  }
  return out
}

export type LimitTone = 'normal' | 'amber' | 'red'

export type LimitView = {
  kind: ContextCacheLimitKind
  title: string
  /** Null when this limit has no reading at all. */
  usage: number | null
  time: number | null
  tone: LimitTone
  color: Tone
  reset: string
}

// Each limit keeps its own colour while on pace; amber when well ahead of the time, red from 90%.
const KIND_COLORS: Record<ContextCacheLimitKind, Tone> = { session: 'success', weekly: 'suggestion', fable: 'merged' }
const colorOf = (kind: ContextCacheLimitKind, tone: LimitTone): Tone =>
  tone === 'red' ? 'error' : tone === 'amber' ? 'warning' : KIND_COLORS[kind]

/** Percent of the window that has elapsed, from its reset time. */
export function timePct(limit: ContextCacheLimit, now: number): number | null {
  if (limit.resetsAt === null) return null
  const elapsed = limit.windowMs - (limit.resetsAt - now)
  return Math.max(0, Math.min(100, (elapsed / limit.windowMs) * 100))
}

/** Red at ≥ 90% used; amber when > 15 points and > 1.4× ahead of time. */
export function toneOf(usage: number, time: number | null): LimitTone {
  if (usage >= 90) return 'red'
  const t = time ?? 0
  if (usage - t > 15 && (t === 0 || usage / t > 1.4)) return 'amber'
  return 'normal'
}

export function limitView(kind: ContextCacheLimitKind, limit: ContextCacheLimit | undefined, now: number): LimitView {
  if (!limit) {
    return { kind, title: LIMIT_TITLES[kind], usage: null, time: null, tone: 'normal', color: 'inactive', reset: 'No reading yet' }
  }
  const time = timePct(limit, now)
  const tone = toneOf(limit.usage, time)
  return {
    kind,
    title: LIMIT_TITLES[kind],
    usage: limit.usage,
    time,
    tone,
    color: colorOf(kind, tone),
    reset: fmtReset(limit.resetsAt, now),
  }
}

// ── Cache ──────────────────────────────────────────────────────────────────

export type CacheState = 'warm' | 'cooling' | 'cold' | 'empty'

export type CacheView = {
  state: CacheState
  /** Remaining TTL ÷ TTL, 0 to 1. */
  warmth: number
  remainingMs: number
  color: Tone
  label: string
  hit: number | null
  detail: string
}

/** Warm > 25% of the TTL left, cooling 1–25%, cold at 0; empty with nothing cached. */
export function cacheView(cache: ContextCacheCache, now: number): CacheView {
  const ttl = cache.ttlMs
  const hit = cache.hitRate === null ? null : cache.hitRate * 100
  if (cache.lastAt === null) {
    return {
      state: 'empty',
      warmth: 0,
      remainingMs: 0,
      color: CACHE_COLORS.empty,
      label: 'Empty',
      hit,
      detail: 'Nothing cached yet',
    }
  }
  const remainingMs = Math.max(0, cache.lastAt + ttl - now)
  const warmth = ttl > 0 ? remainingMs / ttl : 0
  const state: CacheState = warmth <= 0 ? 'cold' : warmth > 0.25 ? 'warm' : 'cooling'
  const short = ttl < 10 * 60_000
  const ttlText = `${Math.round(ttl / 60_000)}m`
  const detail =
    state === 'cold'
      ? (() => {
          const ago = now - (cache.lastAt + ttl)
          return ago < 60_000 ? 'Expired just now' : `Expired ${fmtSpan(ago)} ago`
        })()
      : short
        ? `${fmtSpan(remainingMs, true)} left of ${ttlText}`
        : `${Math.max(1, Math.round(remainingMs / 60_000))}m left of ${ttlText}`
  return {
    state,
    warmth,
    remainingMs,
    color: CACHE_COLORS[state],
    label: state === 'warm' ? 'Warm' : state === 'cooling' ? 'Cooling' : 'Cold',
    hit,
    detail,
  }
}

/** The notice line's copy. Always a line: the row with Clear / Compact never hides. */
export function noticeText(cache: CacheView, context: ContextCacheContext | null, ttlMs: number): string {
  if (!context) return cache.state === 'empty' ? 'Cache empty: nothing cached yet.' : `Cache ${cache.label.toLowerCase()}: reading context size…`
  const tokens = fmtTokens(context.used)
  if (cache.state === 'empty') return `Cache empty: next message writes ${tokens} to cache.`
  if (cache.state === 'warm') {
    const usedPct = (context.used / context.window) * 100
    if (context.autoCompactAt !== null && usedPct >= 85) {
      const away = Math.max(0, pct((context.autoCompactAt / context.window) * 100 - usedPct))
      return `Cache warm: next message reuses ${tokens}. Auto-compact is ${away}% away.`
    }
    return `Cache warm: next message reuses ${tokens} from cache.`
  }
  if (cache.state === 'cooling') {
    const within =
      ttlMs < 10 * 60_000 ? fmtSpan(cache.remainingMs, true) : `${Math.max(1, Math.round(cache.remainingMs / 60_000))}m`
    return `Cache cooling: send within ${within} to keep ${tokens} cached.`
  }
  return `Cache cold: next message re-reads ${tokens}. Clear is free.`
}

// ── Layout ─────────────────────────────────────────────────────────────────

export type ViewModel = {
  context: {
    used: number
    window: number
    usedPct: number
    compactPct: number | null
    segments: { group: ContextCacheGroup; tokens: number; color: Tone; label: string }[]
    free: number
  } | null
  limits: LimitView[]
  cache: CacheView
  notice: string
  showLegend: boolean
  showNotice: boolean
  /** False when the band has too few rows for the expanded panel: draw the one-line summary instead. */
  fits: boolean
}

/** Rows the expanded terminal panel takes: context, legend, a gap, the rings' two lines, a gap, notice and buttons. */
export function rowsOf(vm: Pick<ViewModel, 'showLegend' | 'showNotice'>): number {
  return 1 + (vm.showLegend ? 1 : 0) + 1 + 2 + (vm.showNotice ? 3 : 0)
}

export function buildView(
  snap: ContextCacheSnapshot,
  now: number,
  columns: number,
  maxRows: number,
): ViewModel {
  const cache = cacheView(snap.cache, now)
  const notice = noticeText(cache, snap.context, snap.cache.ttlMs)

  const ctx = snap.context
  const context = ctx
    ? {
        used: ctx.used,
        window: ctx.window,
        usedPct: pct((ctx.used / ctx.window) * 100),
        compactPct: ctx.autoCompactAt === null ? null : pct((ctx.autoCompactAt / ctx.window) * 100),
        segments: GROUPS.map(g => ({
          group: g,
          tokens: ctx.parts[g],
          color: GROUP_COLORS[g],
          label: GROUP_LABELS[g],
        })),
        free: Math.max(0, ctx.window - ctx.used),
      }
    : null

  const byKind = (k: ContextCacheLimitKind) => snap.limits.find(l => l.kind === k)
  const limits = (['session', 'weekly', 'fable'] as const).map(k => limitView(k, byKind(k), now))

  // Drop the legend, then the notice row, when the band is short of rows.
  const fit = { showLegend: context !== null && columns >= 50, showNotice: true }
  if (rowsOf(fit) > maxRows) fit.showLegend = false
  if (rowsOf(fit) > maxRows) fit.showNotice = false

  return {
    context,
    limits,
    cache,
    notice,
    ...fit,
    fits: rowsOf(fit) <= maxRows,
  }
}
