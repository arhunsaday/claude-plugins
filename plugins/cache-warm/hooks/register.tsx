// cache-warm: the main conversation's prompt cache above the prompt. How long
// it stays warm, what each reply read from it and wrote to it, what it saved,
// and a keep-warm ping (by hand, or by itself while you are away) that re-reads
// the cached prefix through $.model.fork before it lapses, so the next message
// does not pay to write the whole conversation again.
//
// Where each figure comes from:
// - Warmth: when the last main-thread request started (the cache's TTL runs from
//   a request's start, not its reply) and the TTL it was cached with (the
//   transcript's usage, or the engine's model-switch report).
// - Hit rate, read, written: each response's usage as the API reported it.
// - Saved: those counts priced at a tenth for a read (a fortieth on Claude Fable
//   5.1) and 1.25× (5m) or 2× (1h) for a write, against sending every token uncached.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheWarmReply, CacheWarmSnapshot } from '../types'
import {
  autoMarginMs,
  buildView,
  emptySnapshot,
  fmtSpan,
  fmtTokens,
  fmtTtl,
  hitRate,
  pct,
  readRate,
  savedShare,
  TTL_1H,
  TTL_5M,
  ttlFromTranscript,
  warmthOf,
  withReply,
} from './model'
import { footerRingDesktop, footerRingTerminal, modeLabel, renderDesktop, renderTerminal, type Actions } from './view'

const snapshotAtom = atom({ plugin: 'cache-warm', key: 'snapshot' } as const, null)
const openAtom = atom({ plugin: 'cache-warm', key: 'isOpen' } as const, true)
const collapsedAtom = atom({ plugin: 'cache-warm', key: 'isCollapsed' } as const, true)
const autoAtom = atom({ plugin: 'cache-warm', key: 'isAuto' } as const, false)
const pingingAtom = atom({ plugin: 'cache-warm', key: 'isPinging' } as const, false)
const nowAtom = atom({ plugin: 'cache-warm', key: 'now' } as const, 0)

const PING_PROMPT = 'Keep-alive ping from the cache-warm mod, not a request: reply with the single word "ok".'
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024 - 1024

const COMMANDS = [
  { name: 'cache-warm', description: 'Prompt cache band: show or hide it' },
  { name: 'cache-warm-ping', description: 'Prompt cache: keep it warm now (re-reads the cached conversation)' },
  { name: 'cache-warm-auto', description: 'Prompt cache: turn automatic keep-warm pings on or off' },
  { name: 'cache-warm-collapse', description: 'Prompt cache band: fold it to one line, or open it again' },
  { name: 'cache-warm-status', description: 'Prompt cache: every figure, the TTL and the keep-warm settings' },
] as const

type Options = { maxAutoPings: number; notify: boolean }

function optionsOf(raw: unknown): Options {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const max = Number(o['maxAutoPings'])
  return { maxAutoPings: Number.isFinite(max) && max >= 1 ? Math.floor(max) : 4, notify: o['notify'] === true }
}

// Module state: rebuilt on reload; what the drawing needs lives in $.state.
let isWorking = false
let isPinging = false
let stepsThisTurn = 0
let turnStartedAt = 0
// Automatic pings since the person last sent a message; capped so an empty desk does not ping all night.
let autoPings = 0
let isCapToasted = false
// The lastAt each alert was raised for, so each fires once per cache entry.
let warnedFor: number | null = null
let lapsedFor: number | null = null

async function current($: EngineInterface): Promise<CacheWarmSnapshot> {
  const snap = await read($, snapshotAtom)
  if (snap) return snap
  const stored = await $.store.get('ttlMs')
  const isKnown = stored === TTL_5M || stored === TTL_1H
  return emptySnapshot(isKnown ? stored : TTL_1H, isKnown)
}

async function edit($: EngineInterface, fn: (s: CacheWarmSnapshot) => CacheWarmSnapshot) {
  const base = await current($)
  await update($, snapshotAtom, prev => fn(prev ?? base))
  const now = await $.clock.now()
  await update($, nowAtom, () => now)
}

async function setTtl($: EngineInterface, ttlMs: number) {
  await $.store.set('ttlMs', ttlMs)
  await edit($, s => ({ ...s, ttlMs, isTtlKnown: true }))
}

/** The conversation was replaced (clear, compact, model switch): nothing of it is cached now. */
async function forget($: EngineInterface, prefixTokens = 0) {
  await edit($, s => ({ ...s, lastAt: null, prefixTokens }))
}

async function learnTtl($: EngineInterface, transcriptPath: string | undefined) {
  if (!transcriptPath) return
  try {
    const stat = await $.fs.stat(transcriptPath)
    if (stat.size > MAX_TRANSCRIPT_BYTES) return
    const text = await $.fs.read(transcriptPath)
    const ttl = ttlFromTranscript(typeof text === 'string' ? text : '')
    if (ttl !== null) await setTtl($, ttl)
  } catch {
    // unreadable: the stored TTL stands
  }
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model?: string }

/** `at` is when the request started: the cache entry's TTL runs from there, so a long reply eats into it. */
async function record($: EngineInterface, u: Usage, isPing: boolean, at: number) {
  const reply: CacheWarmReply = {
    at,
    read: u.cache_read_input_tokens,
    written: u.cache_creation_input_tokens,
    uncached: u.input_tokens,
    isPing,
  }
  // A ping's own tail is never cached: the prefix the next message re-sends is unchanged.
  const prefix = isPing ? null : u.cache_read_input_tokens + u.cache_creation_input_tokens + u.input_tokens + u.output_tokens
  await edit($, s => withReply(s, reply, prefix, readRate(u.model)))
}

/** Re-reads the cached conversation through a fork, which resets the cache's TTL. Resolves what to tell the person. */
async function ping($: EngineInterface): Promise<string> {
  if (isPinging) return 'A keep-warm ping is already on its way.'
  if (isWorking) return 'A turn is running: its own requests keep the cache warm.'
  isPinging = true
  await update($, pingingAtom, () => true)
  try {
    const startedAt = await $.clock.now()
    const r = await $.model.fork({ prompt: PING_PROMPT })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') return 'Nothing cached to keep warm yet: the first reply writes the cache.'
    const u = r.usage
    if (u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) await record($, u, true, startedAt)
    if (!r.isAnswered && r.reason === 'api-error') return `Keep-warm ping failed: ${r.error}${r.status === null ? '' : ` (HTTP ${r.status})`}.`
    if (!r.isAnswered && r.reason === 'aborted') return 'Keep-warm ping was cut short.'
    const ttl = fmtTtl((await current($)).ttlMs)
    if (u.cache_read_input_tokens > 0) return `Cache kept warm: ${fmtTokens(u.cache_read_input_tokens)} tokens re-read, ${ttl} on the clock again.`
    if (u.cache_creation_input_tokens > 0) return `The cache had lapsed: the ping wrote ${fmtTokens(u.cache_creation_input_tokens)} tokens back.`
    return 'The ping reached no cache.'
  } catch (err) {
    return `Keep-warm ping failed: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    isPinging = false
    await update($, pingingAtom, () => false).catch(() => undefined)
  }
}

async function toggleCollapsed($: EngineInterface): Promise<boolean> {
  const isCollapsed = !(await read($, collapsedAtom))
  await update($, collapsedAtom, () => isCollapsed)
  await $.store.set('isCollapsed', isCollapsed)
  return isCollapsed
}

async function toggleAuto($: EngineInterface): Promise<boolean> {
  const isAuto = !(await read($, autoAtom))
  await update($, autoAtom, () => isAuto)
  await $.store.set('isAuto', isAuto)
  autoPings = 0
  isCapToasted = false
  return isAuto
}

async function toggleOpen($: EngineInterface): Promise<boolean> {
  const isOpen = !(await read($, openAtom))
  await update($, openAtom, () => isOpen)
  await $.store.set('isOpen', isOpen)
  return isOpen
}

function actionsFor($: EngineInterface, opts: Options): Actions {
  return {
    ping: async () => $.ui.toast(await ping($)),
    auto: async () => {
      const isAuto = await toggleAuto($)
      $.ui.toast(
        isAuto
          ? `Auto keep-warm on: up to ${opts.maxAutoPings} pings while you are away, each a cache read that costs a fraction of a rewrite.`
          : 'Auto keep-warm off.',
      )
    },
    toggle: () => void toggleCollapsed($),
  }
}

async function statusReport($: EngineInterface, opts: Options): Promise<string> {
  const s = await current($)
  const now = await $.clock.now()
  const w = warmthOf(s, now)
  const hit = hitRate(s.totals)
  const saved = savedShare(s.totals, s.ttlMs)
  const isAuto = await read($, autoAtom)
  return [
    `State: ${w.state}${w.state === 'warm' || w.state === 'cooling' ? `, ${fmtSpan(w.remainingMs)} left` : ''}`,
    `TTL: ${fmtTtl(s.ttlMs)}${s.isTtlKnown ? '' : ' (assumed until a reply says)'}`,
    `Last write or read: ${s.lastAt === null ? 'none' : new Date(s.lastAt).toISOString()}`,
    `Prefix the next message re-sends: ${fmtTokens(s.prefixTokens)} tokens`,
    `Session: ${hit === null ? '—' : pct(hit)} hit, ${fmtTokens(s.totals.read)} read, ${fmtTokens(s.totals.written)} written, ${fmtTokens(s.totals.uncached)} uncached`,
    `Input cost against no cache: ${saved === null ? '—' : saved >= 0 ? `−${pct(saved)}` : `+${pct(-saved)}`}`,
    `Lapses between replies: ${s.lapses}`,
    `Keep-warm: ${isAuto ? 'auto' : 'off'}, ${s.pings} pings (${fmtTokens(s.pingRead)} re-read), ${autoPings}/${opts.maxAutoPings} automatic since your last message; auto pings ${fmtSpan(autoMarginMs(s.ttlMs))} before the cache lapses`,
    `Notifications when cooling: ${opts.notify ? 'on' : 'off'}`,
  ].join('\n')
}

/** Once a second: redraw when a shown figure changes, warn as the cache cools, ping when auto is on. */
async function tick($: EngineInterface, opts: Options, last: { shown: string }) {
  const s = await read($, snapshotAtom)
  if (!s) return
  const now = await $.clock.now()
  const w = warmthOf(s, now)
  const isOpen = await read($, openAtom)
  const isAuto = await read($, autoAtom)

  const shown = `${w.state}|${w.remainingMs > 0 ? fmtSpan(w.remainingMs) : fmtSpan(now - (s.lastAt ?? now))}|${Math.round(w.warmth * 72)}`
  // The footer ring shows whether or not the band does, so it ticks either way.
  if (shown !== last.shown) {
    last.shown = shown
    await update($, nowAtom, () => now)
  }
  if (isWorking || isPinging || s.lastAt === null) return

  const isLive = w.state === 'warm' || w.state === 'cooling'
  if (isAuto && isLive && w.remainingMs <= autoMarginMs(s.ttlMs)) {
    if (autoPings < opts.maxAutoPings) {
      autoPings += 1
      const text = await ping($)
      if (isOpen) $.ui.toast(text)
      return
    }
    if (!isCapToasted) {
      isCapToasted = true
      $.ui.toast(`Auto keep-warm paused after ${opts.maxAutoPings} pings; your next message starts it again.`)
    }
  }

  if (w.state === 'cooling' && warnedFor !== s.lastAt && !isAuto) {
    warnedFor = s.lastAt
    const text = `Prompt cache cools in ${fmtSpan(w.remainingMs)}: the next message would rewrite ${fmtTokens(s.prefixTokens)} tokens.`
    if (isOpen) $.ui.toast(`${text} /cache-warm-ping keeps it warm.`)
    if (opts.notify) void $.ui.notify(text, { title: 'Prompt cache' }).catch(() => undefined)
  }
  if (w.state === 'cold' && lapsedFor !== s.lastAt) {
    lapsedFor = s.lastAt
    if (isOpen && s.prefixTokens > 0) $.ui.toast(`Prompt cache went cold: the next message rewrites ${fmtTokens(s.prefixTokens)} tokens.`)
  }
}

export const register: Register = (on, options) => {
  const opts = optionsOf(options)

  // ── Session lifecycle ──────────────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    // One command each: the desktop composer drops anything typed after a slash command's name.
    for (const c of COMMANDS) await $.command.register(c)
    if ((await $.store.get('isCollapsed')) === false) await update($, collapsedAtom, () => false)
    if ((await $.store.get('isAuto')) === true) await update($, autoAtom, () => true)
    if ((await $.store.get('isOpen')) === false) await update($, openAtom, () => false)
    const initial = await current($)
    await update($, snapshotAtom, prev => prev ?? initial)
    const last = { shown: '' }
    $.clock.every(1000, () => void tick($, opts, last).catch(() => undefined))
    return next(e)
  })

  // Resumed: the transcript says how long ago the last response was and how big the prefix is.
  on('classic.SessionStart', async ($, e, next) => {
    const now = await $.clock.now()
    if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const lastAt = now - e.seconds_since_last_response * 1000
      await edit($, s => ({ ...s, lastAt, prefixTokens: e.context_tokens ?? s.prefixTokens }))
    } else if (e.source === 'clear' || e.source === 'compact') {
      await forget($)
    }
    void learnTtl($, e.transcript_path)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // A turn started: its requests will refresh the cache, and the auto-ping budget starts over.
  on('turn.start', async ($, e, next) => {
    isWorking = true
    stepsThisTurn = 0
    turnStartedAt = await $.clock.now()
    autoPings = 0
    isCapToasted = false
    return next(e)
  })

  // Each main-thread response reads and writes the cache as it lands.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const r = yield* next(e)
    if (e.agentId === undefined && !isPinging && r.usage) {
      stepsThisTurn += 1
      void record($, r.usage, false, startedAt).catch(() => undefined)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      isWorking = false
      // A host that reported no steps: the turn's summed usage stands in for its last response, timed from
      // the turn's start, the earliest its request can have started.
      if (stepsThisTurn === 0 && e.usage && !isPinging) await record($, e.usage, false, turnStartedAt)
    }
    return result
  })

  // After each turn, read which TTL the responses were cached with.
  on('classic.Stop', ($, e, next) => {
    void learnTtl($, e.transcript_path)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // The engine reports the TTL itself on a model switch; a switch also forfeits the cache.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await setTtl($, e.cache_ttl === '5m' ? TTL_5M : TTL_1H)
    await forget($, e.context_tokens)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // A compaction replaces the conversation: nothing of the new one is cached yet.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger !== 'precompute' && !('skip' in result)) await forget($)
    return result
  }).catch((_$, e, next) => next(e))

  // /clear starts a fresh conversation in the same process.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') await forget($)
    return result
  })

  // ── Commands ───────────────────────────────────────────────────────────

  on('command.run', { command: 'cache-warm' }, async $ => {
    const isOpen = await toggleOpen($)
    return { text: isOpen ? 'Prompt cache band shown.' : 'Prompt cache band hidden. The Cache button or /cache-warm shows it again.' }
  })

  on('command.run', { command: 'cache-warm-ping' }, async $ => ({ text: await ping($) }))

  on('command.run', { command: 'cache-warm-auto' }, async $ => {
    const isAuto = await toggleAuto($)
    return {
      text: isAuto
        ? `Auto keep-warm on: while you are away the cache is re-read before it lapses, up to ${opts.maxAutoPings} times.`
        : 'Auto keep-warm off.',
    }
  })

  on('command.run', { command: 'cache-warm-collapse' }, async $ => {
    const isCollapsed = await toggleCollapsed($)
    return { text: isCollapsed ? 'Prompt cache band folded to one line.' : 'Prompt cache band expanded.' }
  })

  on('command.run', { command: 'cache-warm-status' }, async $ => ({ text: await statusReport($, opts) }))

  // ── The Cache button in the prompt footer ──────────────────────────────

  // The warmth ring and the Cache button, beside the model picker and the usage rings. The button is drawn wherever it
  // can be pressed, as plan-progress draws Progress, dim while the band is hidden or nothing is cached; a terminal
  // outside fullscreen has no buttons there, so the ring and the time left join its dim mode labels instead.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const [isOpen, snap, isAuto, pinging, tickNow] = await Promise.all([
      read($, openAtom),
      read($, snapshotAtom),
      read($, autoAtom),
      read($, pingingAtom),
      read($, nowAtom),
    ])
    const vm = snap ? buildView(snap, Math.max(tickNow, await $.clock.now()), isAuto, pinging) : null
    if (e.surface === 'terminal' && e.viewport?.isFullscreen !== true) {
      if (!vm || vm.state === 'empty') return next(e)
      return next({ ...e, props: { ...e.props, modes: [...e.props.modes, modeLabel(vm)] } })
    }
    const isEmpty = !vm || vm.state === 'empty'
    const E = $.ui.resolve(e)
    const { Box, Button } = E
    const ring = vm
      ? e.surface === 'terminal'
        ? footerRingTerminal(E as Parameters<typeof footerRingTerminal>[0], vm)
        : footerRingDesktop(E as Parameters<typeof footerRingDesktop>[0], vm)
      : null
    // other mods add their labels to modes beneath us; keep them
    const below = await next(e)
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {ring}
          <Button key="cache-toggle" dimColor={!isOpen || isEmpty} label="Cache" onPress={() => void toggleOpen($)} />
        </Box>
        {below}
      </Box>
    )
  })

  // ── The band above the prompt ──────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode') return next(e)
    const [snap, isOpen, isCollapsed, isAuto, pinging, tickNow] = await Promise.all([
      read($, snapshotAtom),
      read($, openAtom),
      read($, collapsedAtom),
      read($, autoAtom),
      read($, pingingAtom),
      read($, nowAtom),
    ])
    if (!snap || !isOpen) return next(e)
    const now = Math.max(tickNow, await $.clock.now())
    const vm = buildView(snap, now, isAuto, pinging)
    const actions = actionsFor($, opts)
    const E = $.ui.resolve(e)
    const mine =
      e.surface === 'terminal'
        ? renderTerminal(E as Parameters<typeof renderTerminal>[0], vm, e.props.bodyColumns, actions, isCollapsed)
        : renderDesktop(E as Parameters<typeof renderDesktop>[0], vm, e.props.bodyColumns, actions, isCollapsed)
    // What the host and the plugins after this one draw here stays, under the band.
    const below = await next(e)
    if (!below) return mine
    const { Box } = E
    return (
      <Box flexDirection="column" rowGap={1}>
        {mine}
        {below}
      </Box>
    )
  })
}
