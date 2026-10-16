// The office's rules without engine calls: trades and names, what a tool call looks like, and who sits where.
// The trades, names, colours and the tool-to-activity table are adapted from Le Bureau des agents
// (devlikemasta/bureau-des-agents, shared/activity.ts, MIT), translated to English.

import type { OfficeAct, OfficeActKind, OfficeAgent, OfficeRole, OfficeStats } from '../types'

export const DESKS = 6
/** How long a teammate takes to walk from the door to its desk, and back. */
export const WALK_MS = 2000
/** How long a finished teammate stays to cheer before it walks out; a failed one stays longer. */
export const DONE_STAY_MS = 4000
export const ERROR_STAY_MS = 10000

export const ROLES: Record<OfficeRole, { label: string; color: number }> = {
  lead: { label: 'Lead', color: 0xff8a3d },
  research: { label: 'Research', color: 0x4fb3ff },
  code: { label: 'Code', color: 0x3ddc97 },
  design: { label: 'Design', color: 0xff6fa8 },
  writing: { label: 'Writing', color: 0xa98bff },
  analysis: { label: 'Analysis', color: 0xffc93d },
  helper: { label: 'Helper', color: 0x9aa3b5 },
}

const NAMES: Record<Exclude<OfficeRole, 'lead'>, string[]> = {
  research: ['Iris', 'Hugo', 'Léa', 'Malo', 'Zoé', 'Noé', 'Inès', 'Tom', 'Jade', 'Sacha', 'Lou', 'Nils'],
  code: ['Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis'],
  design: ['Frida', 'Coco', 'Henri', 'Sonia', 'Saul'],
  writing: ['Colette', 'Victor', 'Simone', 'Jules', 'George'],
  analysis: ['Marie', 'Blaise', 'Émilie', 'Gaspard'],
  helper: ['Bob', 'Lulu', 'Gaston', 'Nina', 'Momo', 'Kiki'],
}

/** The trade of a subagent, from the agent type it was spawned as. */
export function roleOf(type: string): OfficeRole {
  const t = type.toLowerCase()
  if (/explor|research|search|find|scout|guide/.test(t)) return 'research'
  if (/design|frontend|ui\b|ux|visual|animat/.test(t)) return 'design'
  if (/review|test|code|refactor|devops|secur|implement|debug|fix|build|migrat/.test(t)) return 'code'
  if (/doc|writ|spec|copy|content/.test(t)) return 'writing'
  if (/plan|analy|data|observ|metric|estimat|audit|rag/.test(t)) return 'analysis'
  return 'helper'
}

/** A first name for a new teammate, never one already in the office. */
export function nameFor(role: OfficeRole, taken: readonly string[]): string {
  if (role === 'lead') return 'Claude'
  const pool = NAMES[role]
  const free = pool.find(n => !taken.includes(n))
  if (free) return free
  let i = 2
  while (taken.includes(`${pool[0]} ${i}`)) i++
  return `${pool[0]} ${i}`
}

const cut = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const base = (p: unknown) => (typeof p === 'string' ? (p.split(/[\\/]/).filter(Boolean).pop() ?? p) : '')
const host = (u: unknown) => {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, '')
  } catch {
    return cut(u, 40)
  }
}

/** The bubble for a tool call. */
export function describeAct(tool: string, input: Record<string, unknown>): OfficeAct {
  const i = input
  const act = (kind: OfficeActKind, label: string): OfficeAct => ({ kind, label, tool })
  switch (tool) {
    case 'WebSearch':
      return act('search', `Searching "${cut(i['query'], 40)}"`)
    case 'WebFetch':
      return act('web', `Reading ${host(i['url'])}`)
    case 'Read':
      return act('read', `Reading ${cut(base(i['file_path']), 36)}`)
    case 'Glob':
    case 'LS':
      return act('read', 'Browsing the folder')
    case 'Grep':
      return act('read', `Looking for "${cut(i['pattern'], 28)}"`)
    case 'Write':
      return act('write', `Writing ${cut(base(i['file_path']), 36)}`)
    case 'Edit':
    case 'MultiEdit':
      return act('edit', `Editing ${cut(base(i['file_path']), 36)}`)
    case 'NotebookEdit':
      return act('edit', `Editing ${cut(base(i['notebook_path']), 36)}`)
    case 'Bash': {
      const c = String(i['command'] ?? '').replace(/\s+/g, ' ').trim()
      return act('bash', c.length <= 32 ? `Running "${c}"` : `Running ${cut(i['description'] || c, 40)}`)
    }
    case 'TodoWrite':
      return act('plan', 'Updating the plan')
    case 'Agent':
    case 'Task':
      return act('plan', `Calling a teammate: ${cut(i['description'], 30)}`)
    case 'Skill':
      return act('skill', `Using the ${cut(i['skill'] ?? i['name'], 24)} skill`)
    case 'AskUserQuestion':
      return act('ask', 'Asking you a question')
    case 'ToolSearch':
      return act('other', 'Looking for the right tool')
  }
  if (tool.startsWith('mcp__')) {
    const server = (tool.split('__')[1] ?? '').replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/[_-]+/g, ' ')
    return act('mcp', `Using ${cut(server, 24)}`)
  }
  return act('other', `Using ${cut(tool, 30)}`)
}

export const emptyStats = (): OfficeStats => ({ agents: 0, searches: 0, pages: 0, reads: 0, writes: 0, commands: 0 })

export function countAct(s: OfficeStats, kind: OfficeActKind): OfficeStats {
  const key: keyof OfficeStats | null =
    kind === 'search' ? 'searches' : kind === 'web' ? 'pages' : kind === 'read' ? 'reads' : kind === 'write' || kind === 'edit' ? 'writes' : kind === 'bash' ? 'commands' : null
  return key ? { ...s, [key]: s[key] + 1 } : s
}

/** The first free desk, or -1 when all six are taken. */
export function freeDesk(agents: readonly OfficeAgent[]): number {
  for (let d = 0; d < DESKS; d++) if (!agents.some(a => a.desk === d)) return d
  return -1
}

/** Where a teammate is in its walk: 'in' from the door, 'seated', 'out' to the door, or 'gone'. */
export type Phase = { at: 'in' | 'seated' | 'out' | 'gone'; t: number }

export function phaseOf(a: OfficeAgent, now: number): Phase {
  const walkedIn = (now - a.startedAt) / WALK_MS
  if (a.endedAt === null) return walkedIn < 1 ? { at: 'in', t: Math.max(0, walkedIn) } : { at: 'seated', t: 1 }
  const stay = a.state === 'error' ? ERROR_STAY_MS : DONE_STAY_MS
  const out = (now - a.endedAt - stay) / WALK_MS
  if (out < 0) return { at: 'seated', t: 1 }
  return out < 1 ? { at: 'out', t: out } : { at: 'gone', t: 1 }
}

/** Drops the teammates who have left, and gives a hallway one the first desk that frees up. */
export function tidy(agents: readonly OfficeAgent[], now: number): OfficeAgent[] {
  const out = agents.filter(a => phaseOf(a, now).at !== 'gone')
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!
    if (a.desk >= 0) continue
    const desk = freeDesk(out)
    if (desk >= 0) out[i] = { ...a, desk }
  }
  return out
}

export const isMoving = (agents: readonly OfficeAgent[], now: number) =>
  agents.some(a => {
    const p = phaseOf(a, now).at
    return p === 'in' || p === 'out'
  })
