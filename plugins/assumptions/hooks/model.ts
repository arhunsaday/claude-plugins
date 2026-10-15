// The list's rules, without engine calls, so the tests can hold them: what a
// log call adds, what a verdict changes, and the prompt a wrong guess sends.

import type { Assumption } from '../types'

export const MAX_TEXT = 160
export const MAX_WHERE = 80
export const MAX_ITEMS = 200

type Raw = Record<string, unknown>

// the cut drops half a character left at the edge (an emoji is two UTF-16 units)
const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, '').trimEnd() : ''

/** The guesses one log call carries: `{text, where}` alone or `{items: [...]}`. */
export function entriesOf(input: Raw): { text: string; where: string | null }[] {
  const raw = Array.isArray(input['items']) ? (input['items'] as unknown[]) : [input]
  return raw
    .filter((x): x is Raw => Boolean(x) && typeof x === 'object')
    .map(x => ({ text: str(x['text'], MAX_TEXT), where: str(x['where'], MAX_WHERE) || null }))
    .filter(x => x.text !== '')
}

const same = (a: Assumption, text: string, where: string | null) =>
  a.text.toLowerCase() === text.toLowerCase() && (a.where ?? '') === (where ?? '')

/** Adds what is new; a guess already on the list (same text, same place) is not logged twice. */
export function withLogged(items: readonly Assumption[], entries: { text: string; where: string | null }[], now: number): { items: Assumption[]; added: Assumption[] } {
  let next = items.reduce((n, a) => Math.max(n, a.id), 0) + 1
  const added: Assumption[] = []
  for (const e of entries) {
    if ([...items, ...added].some(a => same(a, e.text, e.where))) continue
    added.push({ id: next++, text: e.text, where: e.where, verdict: 'unchecked', at: now, fixSentAt: null })
  }
  return { items: [...items, ...added].slice(-MAX_ITEMS), added }
}

export const toCheck = (items: readonly Assumption[]) => items.filter(a => a.verdict === 'unchecked').length

/** The prompt sent for a wrong guess: only that part is redone, the confirmed ones stay. */
export function fixPrompt(wrong: Assumption, items: readonly Assumption[]): string {
  const at = wrong.where ? ` (${wrong.where})` : ''
  const kept = items.filter(a => a.verdict === 'right')
  const lines = [
    `The user marked assumption #${wrong.id} as wrong${at}: "${wrong.text}".`,
    'Fix only what depends on it. If the right choice is not clear from the conversation or the code, ask the user before changing anything.',
  ]
  if (kept.length) {
    lines.push(`Keep these, the user confirmed them: ${kept.map(a => `#${a.id} "${a.text}"`).join('; ')}.`)
  }
  lines.push('Log any new assumption the fix makes, as usual.')
  return lines.join('\n')
}

/** `3`, `3 5`, `#3,#5`: the numbers a command names. */
export function idsOf(args: string): number[] {
  return [...args.matchAll(/\d+/g)].map(m => Number(m[0])).filter(n => n > 0)
}
