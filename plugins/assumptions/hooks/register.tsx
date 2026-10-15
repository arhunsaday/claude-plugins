// assumptions: the small guesses Claude makes without asking, listed above the prompt for the person to check.
//
// Claude logs each guess through a tool of the mod's own (assumption_log, named in a short system-prompt rule) as it
// makes it. When the turn ends, a strip says how many it made; the list marks each right or wrong, and a wrong one
// sends Claude a prompt to redo only that part, naming the ones confirmed right so they stay. Nothing is written to
// the repository: the list lives in the session's state and goes with /clear.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Assumption, AssumptionVerdict } from '../types'
import { entriesOf, fixPrompt, idsOf, withLogged } from './model'
import { renderList, type Actions } from './view'

const TOOL = 'mcp__assumptions__assumption_log'
const PANE = 'assumptions'
const itemsAtom = atom({ plugin: 'assumptions', key: 'items' } as const, [])
const collapsedAtom = atom({ plugin: 'assumptions', key: 'isCollapsed' } as const, true)

const RULES = `# Assumptions
When you fill a gap the user left open and decide it yourself instead of asking (a default value, a name, a file location, an edge case, a library, a format, what happens on error), log it with ${TOOL} as you make it: {text: what you assumed, in a few words, in the user's language; where: the file or area}; several at once as {items: [...]}. Log real guesses that shape what you build, not facts you checked or what the user said. Keep working after logging, don't ask about them, and don't mention the log to the user: they review the list themselves.`

const COMMANDS = [
  { name: 'assumptions', description: "Open the full list of Claude's assumptions" },
  { name: 'assumptions-right', description: 'Mark assumptions right: their numbers, or "all"' },
  { name: 'assumptions-wrong', description: 'Mark assumptions wrong by number; Claude gets a prompt to fix each' },
  { name: 'assumptions-clear', description: 'Remove the checked assumptions from the list' },
  { name: 'assumptions-collapse', description: 'Fold the assumptions strip to one line, or open it again' },
] as const

async function mark($: EngineInterface, id: number, verdict: AssumptionVerdict): Promise<string> {
  const now = await $.clock.now()
  let wrong: Assumption | null = null
  let found = false
  let wasWrong = false
  const items = await update($, itemsAtom, list =>
    list.map(a => {
      if (a.id !== id) return a
      found = true
      // a wrong one is final: its fix prompt has gone
      if (a.verdict === 'wrong') {
        wasWrong = true
        return a
      }
      if (verdict === 'wrong') {
        wrong = { ...a, verdict, fixSentAt: now }
        return wrong
      }
      return { ...a, verdict }
    }),
  )
  if (!found) return `No assumption #${id}.`
  if (wasWrong) return `#${id} is already marked wrong; its fix was sent.`
  const sent = wrong as Assumption | null
  if (!sent) return verdict === 'right' ? `#${id} marked right.` : `#${id} back to unchecked.`
  // The prompt runs once the session is idle; a turn under way finishes first.
  void $.prompt.submit({ text: fixPrompt(sent, items) }).catch(() => $.ui.toast(`Could not send the fix for #${id}.`))
  return `#${id} marked wrong: Claude got a prompt to fix it.`
}

async function allRight($: EngineInterface): Promise<number> {
  let n = 0
  await update($, itemsAtom, list =>
    list.map(a => {
      if (a.verdict !== 'unchecked') return a
      n += 1
      return { ...a, verdict: 'right' as const }
    }),
  )
  return n
}

async function clearChecked($: EngineInterface): Promise<number> {
  let n = 0
  await update($, itemsAtom, list => {
    const kept = list.filter(a => a.verdict === 'unchecked')
    n = list.length - kept.length
    return kept
  })
  return n
}

async function toggleCollapsed($: EngineInterface): Promise<boolean> {
  const isCollapsed = !(await read($, collapsedAtom))
  await update($, collapsedAtom, () => isCollapsed)
  await $.store.set('isCollapsed', isCollapsed)
  return isCollapsed
}

function actionsFor($: EngineInterface, canFold: boolean): Actions {
  return {
    mark: (id, verdict) => void mark($, id, verdict).then(text => verdict === 'wrong' && $.ui.toast(text)),
    allRight: () => void allRight($),
    clearChecked: () => void clearChecked($),
    toggle: canFold ? () => void toggleCollapsed($) : undefined,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'assumption_log',
      description:
        'Log a small assumption you made without asking (a default, a name, a location, an edge case) so the user can confirm or reject it later. {text, where?} or {items: [{text, where?}]}.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What you assumed, in a few words' },
          where: { type: 'string', description: 'The file or area it applies to' },
          items: {
            type: 'array',
            description: 'Several assumptions at once',
            items: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, where: { type: 'string' } } },
          },
        },
      },
      // in the prompt's tool list, not behind ToolSearch: a guess is logged in passing, so the tool must be at hand
      isDeferred: false,
    })
    // One command each: the desktop composer drops anything typed after a slash command's name.
    for (const c of COMMANDS) await $.command.register(c)
    if ((await $.store.get('isCollapsed')) === false) await update($, collapsedAtom, () => false)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    return { sections: [...result.sections, { id: 'assumptions:rules', text: RULES, scope: 'session' as const }] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const entries = entriesOf(e as unknown as Record<string, unknown>)
    if (entries.length === 0) return { deny: 'assumption_log: give {text, where?} or {items: [{text, where?}]}.' }
    const now = await $.clock.now()
    let added: Assumption[] = []
    await update($, itemsAtom, list => {
      const r = withLogged(list, entries, now)
      added = r.added
      return r.items
    })
    return { result: added.length ? `logged ${added.map(a => `#${a.id}`).join(', ')}` : 'already logged' }
  })

  // /clear starts a new conversation: its guesses start over.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') await update($, itemsAtom, () => [])
    return result
  })

  // ── Commands ───────────────────────────────────────────────────────────

  on('command.run', { command: 'assumptions' }, async $ => {
    if ((await read($, itemsAtom)).length === 0) return { text: 'No assumptions logged yet.' }
    await $.ui.open({ id: PANE, title: 'Assumptions' })
    return { text: 'Assumptions opened.' }
  })

  on('command.run', { command: 'assumptions-right' }, async ($, e) => {
    if (/\ball\b/i.test(e.args)) return { text: `${await allRight($)} marked right.` }
    const ids = idsOf(e.args)
    if (ids.length === 0) return { text: 'Give the numbers to mark right, or "all".' }
    const lines: string[] = []
    for (const id of ids) lines.push(await mark($, id, 'right'))
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'assumptions-wrong' }, async ($, e) => {
    const ids = idsOf(e.args)
    if (ids.length === 0) return { text: 'Give the numbers to mark wrong.' }
    const lines: string[] = []
    for (const id of ids) lines.push(await mark($, id, 'wrong'))
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'assumptions-clear' }, async $ => ({ text: `${await clearChecked($)} checked assumptions removed.` }))

  on('command.run', { command: 'assumptions-collapse' }, async $ => {
    const isCollapsed = await toggleCollapsed($)
    return { text: isCollapsed ? 'Assumptions folded to one line.' : 'Assumptions expanded.' }
  })

  // ── The strip above the prompt, once the turn is over ──────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking || e.props.view.agentId !== undefined) return next(e)
    const [items, isCollapsed] = await Promise.all([read($, itemsAtom), read($, collapsedAtom)])
    if (items.length === 0) return next(e)
    const E = $.ui.resolve(e)
    const mine = renderList(E as Parameters<typeof renderList>[0], items, actionsFor($, true), {
      isDesktop: e.surface !== 'terminal',
      isCollapsed,
      // the header and the buttons row with the gap between them take three of the band's rows
      rows: Math.max(3, e.props.maxRows - 3),
      isPane: false,
    })
    // What the host and the plugins after this one draw here stays, under the strip.
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

  // ── The full list as a pane (/assumptions) ─────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const items = await read($, itemsAtom)
    const E = $.ui.resolve(e)
    if (items.length === 0) {
      const { Text } = E
      return <Text dimColor>No assumptions logged yet.</Text>
    }
    return renderList(E as Parameters<typeof renderList>[0], items, actionsFor($, false), {
      isDesktop: e.surface !== 'terminal',
      isCollapsed: false,
      rows: Math.max(items.length, e.props.scroll.bodyRows - 3),
      isPane: true,
    })
  })
}
