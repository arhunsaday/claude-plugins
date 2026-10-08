// where-am-i: a live recap above the prompt (goal, now, next, what waits on you), plus /where.
// Adapted from hamzafer/claude-code-mods (MIT).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WhereRecap } from '../types'
import { describe, isTrivial, LONG_SYSTEM, parseRecap, SUMMARY_SYSTEM } from './recap'
import { renderBand } from './view'

export { clip, describe, isTrivial, parseRecap } from './recap'

const MODEL = 'haiku'
const MAX_LOG = 20

// Held by the host, so the recap survives a hot reload of this file.
const recap = atom({ plugin: 'where-am-i', key: 'recap' } as const, null as WhereRecap | null)
const live = atom({ plugin: 'where-am-i', key: 'live' } as const, '')
const prompt = atom({ plugin: 'where-am-i', key: 'prompt' } as const, '')
const since = atom({ plugin: 'where-am-i', key: 'since' } as const, null as number | null)
const turns = atom({ plugin: 'where-am-i', key: 'turns' } as const, 0)
const collapsed = atom({ plugin: 'where-am-i', key: 'isCollapsed' } as const, false)
const tick = atom({ plugin: 'where-am-i', key: 'tick' } as const, 0)

async function toggleCollapsed($: EngineInterface): Promise<boolean> {
  const isCollapsed = !(await read($, collapsed))
  await update($, collapsed, () => isCollapsed)
  await $.store.set('isCollapsed', isCollapsed)
  return isCollapsed
}

async function summarize($: EngineInterface, said: string, log: string[], answer: string) {
  const before = await read($, recap)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 300,
    system: SUMMARY_SYSTEM,
    prompt: [
      `Previous recap: ${before ? JSON.stringify(before) : 'none'}`,
      `The person's latest message: ${said}`,
      `Tools used this turn: ${log.join('; ') || 'none'}`,
      `The assistant's reply: ${answer.slice(0, 2500)}`,
    ].join('\n\n'),
  })
  if (!r.isAnswered) return
  const parsed = parseRecap(r.text)
  if (!parsed) return
  // A new goal restarts the clock beside it.
  if (!before || before.goal !== parsed.goal) {
    const at = await $.clock.now()
    await update($, since, s => (before ? at : (s ?? at)))
  }
  await update($, recap, () => parsed)
}

async function longRecap($: EngineInterface, said: string, log: string[]) {
  const messages = (await $.session.messages()).slice(-12)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 500,
    system: LONG_SYSTEM,
    prompt: [
      `<transcript>\n${messages
        .filter(m => m.text.trim() !== '')
        .map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, 800)}`)
        .join('\n')}\n</transcript>`,
      `Latest message: ${said}`,
      `Recent tool calls: ${log.join('; ') || 'none'}`,
      'Write the recap of the transcript above now: the bullets only, not a reply to it.',
    ].join('\n\n'),
  })
  return r.isAnswered ? r.text : 'Could not build a recap right now.'
}

export const register: Register = on => {
  let said = ''
  let log: string[] = []

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // A name Claude Code already has is refused: start anyway.
    await $.command.register({ name: 'where', description: 'Recap the session so far in a few bullets' }).catch(() => {})
    await $.command.register({ name: 'where-collapse', description: 'Fold the where-am-i recap to one line, or open it again' }).catch(() => {})
    if ((await $.store.get('isCollapsed')) === true) await update($, collapsed, () => true)
    // The elapsed time beside the goal moves once a minute.
    $.clock.every(60_000, () => {
      void $.clock.now().then(t => update($, tick, () => t)).catch(() => {})
    })
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    said = e.text.slice(0, 1500)
    log = []
    if (!said.startsWith('/')) {
      await update($, prompt, () => said)
      await update($, live, () => 'reading your message')
      if ((await read($, since)) === null) {
        const at = await $.clock.now()
        await update($, since, () => at)
      }
    }
    return next(e)
  })

  // Observe only: note what is happening, then let the call run untouched. Only Claude's own calls count:
  // one another mod makes in the background is raised by that plugin, and `next.origin` names it.
  on('tool.call', async ($, e, next) => {
    if (next.origin.plugin !== 'engine') return next(e)
    const line = describe(e as unknown as Record<string, unknown>)
    log = [...log, e.agentId ? `(agent) ${line}` : line].slice(-MAX_LOG)
    if (!e.agentId) await update($, live, () => line)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      await update($, live, () => '')
      await update($, turns, n => n + 1)
      const hasRecap = (await read($, recap)) !== null
      // In the background, so the turn ends at once.
      if (!isTrivial(log.length, e.answer, hasRecap)) void summarize($, said, log, e.answer).catch(() => {})
    }
    return r
  })

  on('command.run', { command: 'where' }, async $ => ({ text: await longRecap($, said, log) }))

  on('command.run', { command: 'where-collapse' }, async $ => {
    const isCollapsed = await toggleCollapsed($)
    return { text: isCollapsed ? 'Recap folded to one line.' : 'Recap expanded.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays, under the recap
    if (e.props.hasSurvey || e.props.view?.agentId !== undefined) return rest
    const [r, l, p, s, n, isCollapsed] = await Promise.all([
      read($, recap),
      read($, live),
      read($, prompt),
      read($, since),
      read($, turns),
      read($, collapsed),
      read($, tick),
    ])
    const mine = renderBand(
      $.ui.resolve(e),
      { recap: r, prompt: p, live: l, isWorking: e.props.isWorking, since: s, turns: n, now: await $.clock.now() },
      e.props.bodyColumns,
      isCollapsed,
      () => void toggleCollapsed($),
    )
    if (!mine) return rest
    if (!rest) return mine
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" rowGap={1}>
        {mine}
        {rest}
      </Box>
    )
  })
}
