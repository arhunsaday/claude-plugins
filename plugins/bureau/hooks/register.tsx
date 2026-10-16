// bureau: the session's agents in Le Bureau des agents (devlikemasta/bureau-des-agents, MIT), in a side pane. Its
// pixel-art office and its engine run here unchanged, on a canvas of our own; instead of the agents of a mission the
// Bureau would start itself, they play this session: Max is Claude, and each subagent Claude calls walks in through
// the door, works at a desk of its trade, hands its report in and leaves. Nothing runs, nothing is billed: the
// office only watches.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { Office } from './office'
import { renderPane } from './view'

const PANE = 'bureau'
/** The engine's own clock: its walks and timers advance in small steps. */
const TICK_MS = 125
/** A frame (drawn and encoded, about 50 ms) at most this often while something moves, */
const MOVE_FRAME_MS = 300
/** and once a second when the office is still, so it keeps blinking and twinkling. */
const IDLE_MS = 1000

const frameAtom = atom({ plugin: 'bureau', key: 'frame' } as const, 0)

const COMMANDS = [
  { name: 'bureau', description: "Ouvre le Bureau des agents dans un panneau" },
  { name: 'bureau-auto', description: 'Ouvre le bureau tout seul quand Claude appelle un agent, ou plus' },
] as const

// Module state: the office lives here, rebuilt empty on a reload.
const office = new Office()
let isPaneOpen = false
let lastStep = 0
let lastFrame = 0

async function openPane($: EngineInterface): Promise<boolean> {
  const r = await $.ui.open({ id: PANE, title: 'Bureau' })
  isPaneOpen = true
  return r.isPlaced
}

/** Something happened in the office: the pane's list says so now, not at the next tick. */
async function poke($: EngineInterface) {
  if (isPaneOpen) await update($, frameAtom, n => n + 1)
}

/** The engine moves on; the pane redraws while something moves, and once a second otherwise. */
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const dt = lastStep ? (now - lastStep) / 1000 : 0
  lastStep = now
  const isMoving = office.step(dt)
  if (!isPaneOpen) return
  if (now - lastFrame >= (isMoving ? MOVE_FRAME_MS : IDLE_MS)) {
    lastFrame = now
    await update($, frameAtom, n => n + 1)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) await $.command.register(c)
    isPaneOpen = (await $.ui.panes()).some(p => p.id === PANE)
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    return next(e)
  })

  // ── Max: the main conversation ─────────────────────────────────────────

  on('turn.start', async ($, e, next) => {
    office.turnStart(e.text)
    await poke($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    if (e.agentId === undefined) office.turnEnd(e.reason !== 'error', e.durationMs)
    else office.leave(e.agentId, e.reason !== 'error', now)
    await poke($)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    office.act(e.tool, input, e.tool_use_id, e.agentId)
    await poke($)
    if (e.agentId === undefined && e.tool === 'AskUserQuestion') {
      office.ask(e.tool_use_id)
      const ran = await next(e)
      office.answered(e.tool_use_id)
      return ran
    }
    return next(e)
  })

  // ── A subagent: a teammate walks in ────────────────────────────────────

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || !r.agentId) return r
    office.hire(r.agentId, e.subagentType, e.description, e.prompt, await $.clock.now())
    if (!isPaneOpen && (await $.store.get('isAuto')) !== false) await openPane($).catch(() => undefined)
    await poke($)
    return r
  })

  // /clear starts a new conversation: the office empties and Max goes back to the door.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') office.reset()
    await poke($)
    return result
  })

  // ── Commands and the pane ──────────────────────────────────────────────

  on('command.run', { command: 'bureau' }, async $ => {
    const isPlaced = await openPane($)
    return { text: isPlaced ? 'Bureau ouvert.' : 'Bureau ouvert ; élargis la fenêtre pour le voir.' }
  })

  on('command.run', { command: 'bureau-auto' }, async $ => {
    const isAuto = (await $.store.get('isAuto')) === false
    await $.store.set('isAuto', isAuto)
    return { text: isAuto ? 'Le bureau s’ouvre tout seul quand Claude appelle un agent.' : 'Le bureau ne s’ouvre plus qu’avec /bureau.' }
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) isPaneOpen = false
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, frameAtom)
    const now = await $.clock.now()
    const png = office.frame(new Date(now))
    return renderPane($.ui.resolve(e) as Parameters<typeof renderPane>[0], e.surface, office, png, e.props.bodyColumns, now)
  })
}
