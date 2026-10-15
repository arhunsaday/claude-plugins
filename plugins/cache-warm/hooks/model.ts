// What the band shows, worked out from the snapshot alone: no engine calls,
// so the tests can hold every figure.

import type { CacheWarmReply, CacheWarmSnapshot, CacheWarmTotals } from '../types'

export type Tone = 'claude' | 'suggestion' | 'merged' | 'inactive' | 'success' | 'warning' | 'error'
export type CacheState = 'warm' | 'cooling' | 'cold' | 'empty'

export const TTL_5M = 5 * 60_000
export const TTL_1H = 60 * 60_000
export const MAX_REPLIES = 32

export const STATE_TONE: Record<CacheState, Tone> = {
  warm: 'claude',
  cooling: 'warning',
  cold: 'suggestion',
  empty: 'inactive',
}
export const STATE_LABEL: Record<CacheState, string> = { warm: 'Warm', cooling: 'Cooling', cold: 'Cold', empty: 'Empty' }
export const STATE_GLYPH: Record<CacheState, string> = { warm: '♨', cooling: '♨', cold: '❄', empty: '○' }

// Input prices relative to an uncached token: a cache read is a tenth (a
// fortieth on Claude Fable 5.1), a write 1.25× for the 5-minute TTL and 2× for the hour.
const READ_RATE = 0.1
export const readRate = (model: string | undefined) => (model !== undefined && /fable-5-1/i.test(model) ? 0.025 : READ_RATE)
export const writeRate = (ttlMs: number) => (ttlMs >= TTL_1H ? 2 : 1.25)

/** How long before the cache lapses an automatic ping goes out. */
export const autoMarginMs = (ttlMs: number) => (ttlMs >= TTL_1H ? 3 * 60_000 : 45_000)

export const emptySnapshot = (ttlMs: number, isTtlKnown: boolean): CacheWarmSnapshot => ({
  lastAt: null,
  ttlMs,
  isTtlKnown,
  prefixTokens: 0,
  replies: [],
  totals: { read: 0, written: 0, uncached: 0, readCost: 0 },
  pings: 0,
  pingRead: 0,
  lastPingAt: null,
  lapses: 0,
})

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

/** Time left or ago: minutes alone from ten minutes up, then minutes and seconds. */
export function fmtSpan(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s >= 600) return `${Math.ceil(s / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${s}s`
}

export const fmtTtl = (ttlMs: number) => (ttlMs >= TTL_1H ? '1h' : `${Math.round(ttlMs / 60_000)}m`)

export function hitRate(t: Pick<CacheWarmTotals, 'read' | 'written' | 'uncached'>): number | null {
  const total = t.read + t.written + t.uncached
  return total > 0 ? t.read / total : null
}

/** The share of the input bill the cache took off, against sending every token uncached; negative when writes outweigh reads. */
export function savedShare(t: CacheWarmTotals, ttlMs: number): number | null {
  const total = t.read + t.written + t.uncached
  if (total === 0) return null
  return 1 - ((t.readCost ?? READ_RATE * t.read) + writeRate(ttlMs) * t.written + t.uncached) / total
}

export type Warmth = {
  state: CacheState
  /** Milliseconds until the cache lapses; 0 once cold or empty. */
  remainingMs: number
  /** Remaining ÷ TTL, 0 to 1. */
  warmth: number
}

/** Warm with more than a quarter of the TTL left, cooling under it, cold at 0; empty with nothing cached. */
export function warmthOf(snap: Pick<CacheWarmSnapshot, 'lastAt' | 'ttlMs'>, now: number): Warmth {
  if (snap.lastAt === null) return { state: 'empty', remainingMs: 0, warmth: 0 }
  const remainingMs = Math.max(0, snap.lastAt + snap.ttlMs - now)
  const warmth = snap.ttlMs > 0 ? remainingMs / snap.ttlMs : 0
  const state: CacheState = remainingMs <= 0 ? 'cold' : warmth > 0.25 ? 'warm' : 'cooling'
  return { state, remainingMs, warmth }
}

const BLOCKS = '▁▂▃▄▅▆▇█'
export type Spark = { ch: string; tone: Tone; isDim: boolean }

/** One glyph per reply, its height the hit rate; a ping is a dot, a reply that wrote more than it read is cold-blue. */
export function sparkOf(replies: readonly CacheWarmReply[], n: number): Spark[] {
  return replies.slice(-n).map(r => {
    if (r.isPing) return { ch: '•', tone: 'inactive', isDim: true }
    const rate = hitRate(r) ?? 0
    const ch = BLOCKS[Math.min(BLOCKS.length - 1, Math.floor(rate * BLOCKS.length))] ?? BLOCKS[0]!
    return { ch, tone: rate >= 0.5 ? 'claude' : 'suggestion', isDim: false }
  })
}

export const pct = (x: number) => `${Math.round(x * 100)}%`

export type ViewModel = Warmth & {
  tone: Tone
  label: string
  glyph: string
  /** The header's dim detail: time left, how long ago it lapsed, or that nothing is cached. */
  detail: string
  ttl: string
  isTtlKnown: boolean
  last: CacheWarmReply | null
  lastHit: number | null
  sessionHit: number | null
  saved: number | null
  totals: CacheWarmTotals
  replies: CacheWarmReply[]
  prefixTokens: number
  pings: number
  pingRead: number
  lapses: number
  isAuto: boolean
  isPinging: boolean
  /** When the next automatic ping goes out, from now; null when none is due. */
  nextPingMs: number | null
  /** A line for a cooling or cold cache; null otherwise. */
  notice: string | null
}

export function buildView(snap: CacheWarmSnapshot, now: number, isAuto: boolean, isPinging: boolean): ViewModel {
  const w = warmthOf(snap, now)
  const last = [...snap.replies].reverse().find(r => !r.isPing) ?? null
  const rewrite = snap.prefixTokens > 0 ? `${fmtTokens(snap.prefixTokens)} tokens` : 'the whole conversation'
  const detail =
    w.state === 'empty'
      ? 'nothing cached yet'
      : w.state === 'cold'
        ? `lapsed ${fmtSpan(now - (snap.lastAt ?? now) - snap.ttlMs)} ago`
        : `${fmtSpan(w.remainingMs)} left of ${fmtTtl(snap.ttlMs)}`
  const notice =
    w.state === 'cooling'
      ? `Cools in ${fmtSpan(w.remainingMs)}: the next message would rewrite ${rewrite}.`
      : w.state === 'cold' && snap.prefixTokens > 0
        ? `Cold: the next message rewrites ${rewrite} at ${writeRate(snap.ttlMs)}× the input price.`
        : null
  const isLive = w.state === 'warm' || w.state === 'cooling'
  return {
    ...w,
    tone: STATE_TONE[w.state],
    label: STATE_LABEL[w.state],
    glyph: STATE_GLYPH[w.state],
    detail,
    ttl: fmtTtl(snap.ttlMs),
    isTtlKnown: snap.isTtlKnown,
    last,
    lastHit: last ? hitRate(last) : null,
    sessionHit: hitRate(snap.totals),
    saved: savedShare(snap.totals, snap.ttlMs),
    totals: snap.totals,
    replies: snap.replies,
    prefixTokens: snap.prefixTokens,
    pings: snap.pings,
    pingRead: snap.pingRead,
    lapses: snap.lapses,
    isAuto,
    isPinging,
    nextPingMs: isAuto && isLive ? Math.max(0, w.remainingMs - autoMarginMs(snap.ttlMs)) : null,
    notice,
  }
}

/** A reply landed: it refreshed the cache, and if the one before had lapsed, that is a lapse. `r.at` is when its request started. */
export function withReply(snap: CacheWarmSnapshot, r: CacheWarmReply, prefixTokens: number | null, rate = READ_RATE): CacheWarmSnapshot {
  const isLapse = !r.isPing && snap.lastAt !== null && r.at - snap.lastAt > snap.ttlMs
  return {
    ...snap,
    lastAt: r.read + r.written > 0 ? r.at : snap.lastAt,
    prefixTokens: prefixTokens ?? snap.prefixTokens,
    replies: [...snap.replies, r].slice(-MAX_REPLIES),
    totals: r.isPing
      ? snap.totals
      : {
          read: snap.totals.read + r.read,
          written: snap.totals.written + r.written,
          uncached: snap.totals.uncached + r.uncached,
          readCost: (snap.totals.readCost ?? READ_RATE * snap.totals.read) + rate * r.read,
        },
    pings: r.isPing ? snap.pings + 1 : snap.pings,
    pingRead: r.isPing ? snap.pingRead + r.read : snap.pingRead,
    lastPingAt: r.isPing ? r.at : snap.lastPingAt,
    lapses: isLapse ? snap.lapses + 1 : snap.lapses,
  }
}

/** The TTL a response was cached with, from the last transcript lines that say. */
export function ttlFromTranscript(text: string): number | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1, seen = 0; i >= 0 && seen < 400; i--, seen++) {
    const line = lines[i]
    if (!line || !line.includes('cache_creation')) continue
    try {
      const row = JSON.parse(line) as { message?: { usage?: { cache_creation?: Record<string, number> } } }
      const cc = row.message?.usage?.cache_creation
      if (!cc) continue
      if ((cc['ephemeral_1h_input_tokens'] ?? 0) > 0) return TTL_1H
      if ((cc['ephemeral_5m_input_tokens'] ?? 0) > 0) return TTL_5M
    } catch {
      // a partial line; keep looking
    }
  }
  return null
}
