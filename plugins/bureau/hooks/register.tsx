// bureau: the session's agents as a small pixel-art office in a side pane, after Le Bureau des agents
// (devlikemasta/bureau-des-agents, MIT). Claude sits at the lead's desk; each subagent it calls walks in through the
// door, takes a desk in its trade's colour, shows what it is doing right now, cheers when it is done and walks out.
// Nothing runs on its own: the office only watches this session's tool calls and subagents.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OfficeAgent, OfficeLead } from '../types'
import { countAct, describeAct, emptyStats, freeDesk, isMoving, nameFor, roleOf, tidy } from './model'
import { renderPane } from './view'

const PANE = 'bureau'
const TICK_MS = 500

const agentsAtom = atom({ plugin: 'bureau', key: 'agents' } as const, [])
const leadAtom = atom({ plugin: 'bureau', key: 'lead' } as const, { state: 'idle', act: null })
const statsAtom = atom({ plugin: 'bureau', key: 'stats' } as const, emptyStats())
const frameAtom = atom({ plugin: 'bureau', key: 'frame' } as const, 0)

const COMMANDS = [
  { name: 'bureau', description: "Open the agents' office in a side pane" },
  { name: 'bureau-auto', description: 'Open the office on its own when Claude calls a subagent, or stop doing so' },
] as const

// Module state: rebuilt on reload.
let isPaneOpen = false
let ticks = 0

async function openPane($: EngineInterface): Promise<boolean> {
  const r = await $.ui.open({ id: PANE, title: 'Bureau' })
  isPaneOpen = true
  return r.isPlaced
}

async function setLead($: EngineInterface, lead: OfficeLead) {
  await update($, leadAtom, () => lead)
}

/** Once every tick: drop who has left, hand out freed desks, and move the animation on while the pane shows. */
async function tick($: EngineInterface) {
  ticks += 1
  const now = await $.clock.now()
  const agents = await read($, agentsAtom)
  const tidied = tidy(agents, now)
  if (tidied.length !== agents.length || tidied.some((a, i) => a.desk !== agents[i]?.desk)) await update($, agentsAtom, () => tidied)
  if (!isPaneOpen) return
  const lead = await read($, leadAtom)
  // a busy office moves twice a second; a quiet one only blinks now and then
  const isBusy = lead.state !== 'idle' || tidied.length > 0 || isMoving(tidied, now)
  if (isBusy || ticks % 4 === 0) await update($, frameAtom, n => n + 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) await $.command.register(c)
    isPaneOpen = (await $.ui.panes()).some(p => p.id === PANE)
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    return next(e)
  })

  // ── The lead: the main conversation ────────────────────────────────────

  on('turn.start', async ($, e, next) => {
    await setLead($, { state: 'working', act: null })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await setLead($, { state: 'idle', act: null })
    } else {
      // a teammate's run ended: it cheers, or looks sad on an error, then walks out
      const now = await $.clock.now()
      const failed = e.reason === 'error'
      await update($, agentsAtom, list =>
        list.map(a => (a.id === e.agentId && a.endedAt === null ? { ...a, state: failed ? ('error' as const) : ('done' as const), endedAt: now, act: null } : a)),
      )
    }
    return result
  })

  // ── Every tool call is a bubble ────────────────────────────────────────

  on('tool.call', async ($, e, next) => {
    const act = describeAct(e.tool, e as unknown as Record<string, unknown>)
    await update($, statsAtom, s => countAct(s, act.kind))
    if (e.agentId === undefined) {
      await setLead($, { state: act.kind === 'ask' ? 'waiting' : 'working', act })
      const ran = await next(e)
      if (act.kind === 'ask') await setLead($, { state: 'working', act: null })
      return ran
    }
    const id = e.agentId
    await update($, agentsAtom, list => list.map(a => (a.id === id && a.endedAt === null ? { ...a, act, tools: a.tools + 1 } : a)))
    return next(e)
  })

  // ── A subagent walks in ────────────────────────────────────────────────

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || !r.agentId) return r
    const id = r.agentId
    const now = await $.clock.now()
    await update($, agentsAtom, list => {
      if (list.some(a => a.id === id)) return list
      const role = roleOf(e.subagentType)
      const agent: OfficeAgent = {
        id,
        name: nameFor(role, list.map(a => a.name)),
        role,
        type: e.subagentType,
        task: e.description,
        desk: freeDesk(list),
        state: 'working',
        act: null,
        startedAt: now,
        endedAt: null,
        tools: 0,
      }
      return [...list, agent]
    })
    await update($, statsAtom, s => ({ ...s, agents: s.agents + 1 }))
    if (!isPaneOpen && (await $.store.get('isAuto')) !== false) void openPane($).catch(() => undefined)
    return r
  })

  // /clear starts a new conversation: the office empties.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      await update($, agentsAtom, () => [])
      await update($, statsAtom, () => emptyStats())
      await setLead($, { state: 'idle', act: null })
    }
    return result
  })

  // ── Commands and the pane ──────────────────────────────────────────────

  on('command.run', { command: 'bureau' }, async $ => {
    const isPlaced = await openPane($)
    return { text: isPlaced ? 'Bureau opened.' : 'Bureau opened; widen the window to see it.' }
  })

  on('command.run', { command: 'bureau-auto' }, async $ => {
    const isAuto = (await $.store.get('isAuto')) === false
    await $.store.set('isAuto', isAuto)
    return {
      text: isAuto ? 'The office opens on its own when Claude calls a subagent.' : 'The office opens only with /bureau.',
    }
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) isPaneOpen = false
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [agents, lead, stats, frame] = await Promise.all([read($, agentsAtom), read($, leadAtom), read($, statsAtom), read($, frameAtom)])
    const now = await $.clock.now()
    const d = new Date(now)
    return renderPane(
      $.ui.resolve(e) as Parameters<typeof renderPane>[0],
      e.surface,
      { agents, lead, stats, now, frame, hour: d.getHours(), minute: d.getMinutes() },
      e.props.bodyColumns,
    )
  })
}
