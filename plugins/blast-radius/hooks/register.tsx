// blast-radius: holds destructive Bash commands and shows what they would destroy, until the person answers.
// Adapted from hamzafer/claude-code-mods (MIT).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HeldCommand } from '../types'
import { classify, timeoutFrom, type Found } from './classify'
import { measure as measureWith } from './measure'
import { report, type Decision } from './view'

export { classify, timeoutFrom } from './classify'

const PANE = 'blast-radius'

// Held by the host, so the drawing redraws when a command is held, counts down or is released.
const held = atom({ plugin: 'blast-radius', key: 'held' } as const, null as HeldCommand | null)
const allowed = atom({ plugin: 'blast-radius', key: 'allowed' } as const, [] as string[])

/** What the command would destroy: the dry runs in ./measure, run through the host. */
async function measure($: EngineInterface, found: Found) {
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  return measureWith(found, {
    home,
    run: async (argv, cwd) => {
      const r = await $.process.run(argv, cwd ? { cwd, timeoutMs: 10_000 } : { timeoutMs: 10_000 })
      return { exitCode: r.exitCode ?? 1, stdout: r.stdout }
    },
  })
}

export const register: Register = (on, options) => {
  // How long a held command waits for a press before it is cancelled; 0 waits forever.
  const timeoutSeconds = timeoutFrom(options.timeoutSeconds)
  const decisions = new Map<string, Decision>()
  // The call holding the pane now. Checked and claimed in one step, so two waiting calls can't both take it.
  let holder: string | null = null

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const found = classify(e.command)
    if (!found) return next(e)
    if ((await read($, allowed)).includes(e.command)) return next(e)

    // Nothing draws the session (a plain `claude -p` run): nobody can see the buttons, so refuse now.
    if ((await $.session.surfaces()).length === 0) {
      const { summary } = await measure($, found)
      return {
        deny:
          `blast-radius: cancelled this command because this session has no screen, so nobody can answer. ` +
          `It would ${summary}. Ask the user to run it themselves.`,
      }
    }

    // One command is held at a time; a second waits its turn (the first one's timeout bounds the wait).
    for (;;) {
      if (next.signal.aborted) return { deny: 'blast-radius: held this command, but the call was stopped before it was shown.' }
      if (holder === null && (await read($, held)) === null && holder === null) break
      await $.process.run(['sleep', '0.25'])
    }
    holder = e.tool_use_id
    try {
      const one: HeldCommand = {
        id: e.tool_use_id,
        command: e.command,
        risk: found.risk,
        ...(await measure($, found)),
        where: 'pane',
        secondsLeft: timeoutSeconds > 0 ? timeoutSeconds : null,
        timeoutSeconds: timeoutSeconds > 0 ? timeoutSeconds : null,
      }
      await update($, held, () => one)

      const opened = await $.ui.open({ id: PANE, title: 'Blast Radius', focus: true })
      if (!opened.isPlaced) {
        await update($, held, h => (h ? { ...h, where: 'band' as const } : h)) // too narrow for a pane: draw above the prompt
      }

      // Nobody pressing within the timeout counts as Cancel, so an unattended session never stalls.
      const deadline = timeoutSeconds > 0 ? (await $.clock.now()) + timeoutSeconds * 1000 : null
      let isTimedOut = false
      while (!decisions.has(one.id) && !next.signal.aborted) {
        if (deadline !== null) {
          const left = Math.ceil((deadline - (await $.clock.now())) / 1000)
          if (left <= 0) {
            isTimedOut = !decisions.has(one.id) // a press that landed at the deadline still counts
            break
          }
          if (left !== one.secondsLeft) {
            one.secondsLeft = left
            await update($, held, h => (h && h.id === one.id ? { ...h, secondsLeft: left } : h))
          }
        }
        await $.process.run(['sleep', '0.25'])
      }
      const decision = isTimedOut ? 'cancel' : (decisions.get(one.id) ?? 'cancel')
      decisions.delete(one.id)
      await update($, held, () => null)
      await $.ui.close({ id: PANE })

      if (decision === 'allow') await update($, allowed, list => [...list, one.command])
      if (decision === 'proceed' || decision === 'allow') return next(e) // runs as written
      if (isTimedOut) {
        return {
          deny:
            `blast-radius: held this command and nobody answered within ${timeoutSeconds} s, so it was cancelled. ` +
            `It would ${one.summary}. Don't retry it on your own: ask the user to run it, or run it again once they're back.`,
        }
      }
      return { deny: `blast-radius: the user pressed Cancel on this command. It would ${one.summary}.` }
    } finally {
      holder = null
      // If the hold failed partway, don't leave its command blocking the next call.
      await update($, held, h => (h && h.id === e.tool_use_id ? null : h)).catch(() => {})
    }
  })

  // The hook's loop picks the press up.
  const decide = (id: string, decision: Decision) => {
    decisions.set(id, decision)
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const one = await read($, held)
    const { Text } = $.ui.resolve(e)
    if (!one) return <Text dimColor>Nothing held.</Text>
    return report($.ui.resolve(e), one, decide)
  })

  // A held command takes the band until answered, above what is drawn there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const one = await read($, held)
    if (!one || one.where !== 'band' || e.props.hasSurvey) return next(e)
    return report($.ui.resolve(e), one, decide)
  })
}
