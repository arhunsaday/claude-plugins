// Pure helpers for where-am-i: what a tool call is doing, the model's recap, when a turn is worth one.

import type { WhereRecap } from '../types'

/** A short label for one tool call: what a person would say Claude is doing. */
export function describe(e: Record<string, unknown>): string {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const file = (p: string) => p.split('/').slice(-2).join('/')
  if (tool === 'Bash') return `running ${s('description') || s('command').slice(0, 60)}`
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return `editing ${file(s('file_path') || s('notebook_path'))}`
  if (tool === 'Read') return `reading ${file(s('file_path'))}`
  if (tool === 'Grep' || tool === 'Glob') return `searching for ${s('pattern').slice(0, 40)}`
  if (tool === 'WebSearch') return `searching the web for ${s('query').slice(0, 40)}`
  if (tool === 'WebFetch') return `reading ${s('url').replace(/^https?:\/\//, '').slice(0, 50)}`
  if (tool === 'Agent' || tool === 'Task') return `starting an agent: ${s('description')}`
  if (tool === 'AskUserQuestion') return 'asking you a question'
  if (tool === 'TodoWrite') return 'updating the task list'
  if (tool.startsWith('mcp__')) return `using ${tool.split('__').slice(1).join(' ').replace(/_/g, ' ')}`
  return `using ${tool}`
}

/** At most `max` characters, one sentence, cut at a word: the model does not always keep to the limit. */
export function clip(text: string, max = 70): string {
  const first = (text.split(/(?<=[.!?])\s/)[0] ?? text).split('\n')[0]!.trim()
  if (first.length <= max) return first.replace(/\.$/, '')
  const cut = first.lastIndexOf(' ', max - 1)
  return `${first.slice(0, cut > max / 2 ? cut : max - 1)}…`
}

/** The model's JSON, tolerating a code fence around it. */
export function parseRecap(text: string): WhereRecap | null {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const o = JSON.parse(body) as Record<string, unknown>
    const field = (k: string) => (typeof o[k] === 'string' ? clip((o[k] as string).replace(/\s*—\s*/g, ', ').trim()) : '')
    if (!field('goal')) return null
    return { goal: field('goal'), now: field('now'), waiting: field('waiting'), next: field('next') }
  } catch {
    return null
  }
}

/** A turn with no tools and a short reply ("thanks", a quick answer) leaves the recap as it is: no model call. */
export function isTrivial(tools: number, answer: string, hasRecap: boolean): boolean {
  return hasRecap && tools === 0 && answer.trim().length < 280
}

/** 45 s → "just now", 12 min → "12m", 3 h 5 min → "3h 5m". */
export function elapsed(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`
}

export const SUMMARY_SYSTEM =
  'You keep a one-glance recap of a coding session for someone who loses track easily. Plain words, no em dashes, ' +
  'each field at most 70 characters. Reply with JSON only: {"goal","now","waiting","next"}. ' +
  '"goal": the overall aim of the session (keep the previous goal unless it clearly changed). ' +
  '"now": what was just done. "waiting": what the assistant needs from the person before it can go on ' +
  '(a question to answer, a choice, something to test), or "" if nothing. "next": the next step.'

export const LONG_SYSTEM =
  'Write a recap of this coding session for someone who lost track. Plain words, no em dashes. ' +
  'At most 6 short bullets: the goal, what is done, what is happening now, what is waiting on them, the next step.'
