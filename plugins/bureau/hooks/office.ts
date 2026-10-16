// The office: Le Bureau des agents' own world and renderer (hooks/engine, unchanged but for the canvas they draw on),
// fed with this session's events instead of the events of a `claude -p` the Bureau would run itself. Max is the
// main conversation; each subagent is a teammate hired for its trade, who walks in, works, hands in its report
// and leaves. A frame is the engine's 352 × 256 image, encoded as a PNG.

import { describeAct, NAMES } from './engine/activity'
import { H, W } from './engine/layout'
import { makeCanvas } from './engine/pixels'
import type { ActKind, OfficeEvent, PlanItem, Role } from './engine/protocol'
import { Renderer } from './engine/render'
import type { TimeOfDay } from './engine/room'
import { World } from './engine/world'
import { base64, encodePng } from './png'

export { H, W }

/** The trade of a subagent, from the agent type Claude called it as. */
export function roleOf(type: string): Role {
  const t = type.toLowerCase()
  if (/explor|research|search|find|scout|guide|cherch/.test(t)) return 'recherche'
  if (/design|frontend|\bui\b|ux|visual|animat/.test(t)) return 'design'
  if (/review|test|code|refactor|devops|secur|implement|debug|fix|build|migrat|develop/.test(t)) return 'code'
  if (/doc|writ|spec|copy|content|redac/.test(t)) return 'redaction'
  if (/plan|analy|data|observ|metric|estimat|audit|rag/.test(t)) return 'analyse'
  return 'renfort'
}

export const timeOfDay = (hour: number): TimeOfDay => (hour >= 8 && hour < 18 ? 'day' : hour >= 18 && hour < 21 ? 'evening' : 'night')

/** What the pane lists under the picture: who is in, what they do right now. */
export type Member = {
  id: string
  name: string
  role: Role
  task: string
  label: string
  startedAt: number
  endedAt: number | null
  ok: boolean | null
}

export class Office {
  world = new World()
  private renderer = new Renderer()
  private canvas = makeCanvas(W, H)
  private g = this.canvas.getContext('2d')
  /** The lead's bubble; null between turns. */
  leadLabel: string | null = null
  members = new Map<string, Member>()
  stats = { agents: 0, searches: 0, pages: 0, reads: 0, writes: 0, commands: 0 }

  private apply(ev: OfficeEvent) {
    this.world.apply(ev, true)
  }

  private count(kind: ActKind) {
    const s = this.stats
    if (kind === 'search') s.searches++
    else if (kind === 'web') s.pages++
    else if (kind === 'read') s.reads++
    else if (kind === 'write' || kind === 'edit') s.writes++
    else if (kind === 'bash') s.commands++
  }

  /** A turn of the main conversation starts: Max sits down to it. */
  turnStart(text: string) {
    if (!this.world.missionActive) this.apply({ k: 'start', text })
    this.apply({ k: 'think', who: 'chef' })
    this.leadLabel = 'Réfléchit'
  }

  /** A turn of the main conversation ends; with nobody still at work, Max goes back to the door to greet you. */
  turnEnd(ok: boolean, ms: number) {
    this.leadLabel = null
    const busy = [...this.members.values()].some(m => m.endedAt === null)
    if (!busy) this.apply({ k: 'end', ok, text: '', ms })
  }

  /** A tool call, by Max (`who` absent) or by a teammate. */
  act(tool: string, input: Record<string, unknown>, callId: string, who?: string) {
    const d = describeAct(tool, input)
    this.count(d.kind)
    const id = who ?? 'chef'
    if (!who) {
      this.leadLabel = d.label
      const todos = input['todos']
      if (tool === 'TodoWrite' && Array.isArray(todos)) {
        const items: PlanItem[] = todos
          .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
          .map(x => ({ text: String(x['content'] ?? ''), status: x['status'] === 'completed' ? 'completed' : x['status'] === 'in_progress' ? 'in_progress' : 'pending' }))
        this.apply({ k: 'plan', items })
      }
    } else {
      const m = this.members.get(who)
      if (!m) return
      m.label = d.label
    }
    this.apply({ k: 'act', who: id, id: callId, kind: d.kind, tool, label: d.label, detail: d.detail })
  }

  /** Max asks you something: a hand goes up until you answer. */
  ask(callId: string) {
    this.leadLabel = 'Te pose une question'
    this.apply({ k: 'ask', who: 'chef', requestId: callId, tool: 'AskUserQuestion', label: '', detail: '', full: false })
  }
  answered(callId: string) {
    this.apply({ k: 'ask_done', requestId: callId, allow: true })
  }

  /** A subagent starts: a teammate of its trade comes in through the door. */
  hire(id: string, type: string, task: string, prompt: string, now: number) {
    if (this.members.has(id)) return
    const role = roleOf(type)
    const taken = new Set([...this.world.actors.values()].map(a => a.name))
    const pool = NAMES[role]
    const name = pool.find(n => !taken.has(n)) ?? `${pool[0]} ${taken.size}`
    this.members.set(id, { id, name, role, task, label: 'Arrive', startedAt: now, endedAt: null, ok: null })
    this.stats.agents++
    this.apply({ k: 'hire', id, role, type, name, task, prompt })
  }

  /** A subagent's run ended: its report goes on Max's desk, then it leaves. */
  leave(id: string, ok: boolean, now: number) {
    const m = this.members.get(id)
    if (!m || m.endedAt !== null) return
    m.endedAt = now
    m.ok = ok
    m.label = ok ? 'Rend son rapport' : 'A échoué'
    this.apply({ k: 'leave', who: id, ok, tokens: 0, tools: 0, ms: now - m.startedAt })
  }

  /** Moves the world on by `dt` seconds; true while something moves. Forgets teammates who have walked out. */
  step(dt: number): boolean {
    const moving = this.world.update(dt)
    for (const [id, m] of this.members) if (m.endedAt !== null && !this.world.actors.has(id)) this.members.delete(id)
    return moving
  }

  reset() {
    this.world.resetAll()
    this.members.clear()
    this.leadLabel = null
    this.stats = { agents: 0, searches: 0, pages: 0, reads: 0, writes: 0, commands: 0 }
  }

  /** The office as it stands, a PNG in base64. */
  frame(now: Date): string {
    this.renderer.draw(this.g, this.world, timeOfDay(now.getHours()), now)
    return base64(encodePng(this.canvas.data, W, H))
  }
}
