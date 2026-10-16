import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.UTC(2026, 9, 16, 9, 30)

const run = ($: Engine, command: string) =>
  $.command.run({ command, args: '', origin: { kind: 'composer' } as never, presentation: { isFullscreen: false, columns: 120 } })

type Started = { clock: MockClock; opened: number }

/** Stands in for the engine beneath the mod, then starts the session. */
async function start($: Engine, on: On): Promise<Started> {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const s: Started = { clock, opened: 0 }
  let spawned = 0
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] as never }))
  on('ui.open', async () => {
    s.opened += 1
    return { value: { isPlaced: true as const } }
  })
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: `agent-${++spawned}` }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async () => ({ sessionId: 's' }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return s
}

const spawn = ($: Engine, subagentType: string, description: string) =>
  $.agent.spawn({ tool_use_id: `t-${description}`, prompt: description, description, subagentType, background: false, fork: false } as never)

const pane = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'bureau', surface, component: 'Pane', requestId: 'bureau', props: { bodyColumns: 70, scroll: { offset: 0, bodyRows: 40 } }, viewport: { columns: 70, rows: 40 } }) as never

test('/bureau opens the pane', async ($, on) => {
  const s = await start($, on)
  expect(JSON.stringify(await run($, 'bureau'))).toContain('Bureau ouvert')
  expect(s.opened).toBe(1)
})

test('the office is a PNG: inside an SVG on the desktop, a picture on the terminal', async ($, on) => {
  await start($, on)
  const desk = await $.ui.mount(pane('desktop'))
  const svg = (await desk.findAll({ type: 'Svg' }))[0]
  expect(String(svg?.props['source'])).toContain('data:image/png;base64,iVBORw0KGgo')
  await desk.unmount()
  const term = await $.ui.mount(pane('terminal'))
  const img = (await term.findAll({ type: 'Image' }))[0]
  expect(String((img?.props['source'] as { png?: string } | undefined)?.png).startsWith('iVBORw0KGgo')).toBe(true)
  await term.unmount()
})

test('Max shows what Claude is doing', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/repo/src/app.ts' } as never)
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ text: /Max au travail/ })).toBeDefined()
  expect(await ui.find({ text: /Je lis app\.ts/ })).toBeDefined()
  expect(await ui.find({ text: /1 lectures/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent is hired for its trade, works and leaves', async ($, on) => {
  const s = await start($, on)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await spawn($, 'Explore', 'Map the routes')
  // the office opens on its own the first time a teammate is called
  expect(s.opened).toBe(1)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ text: /Iris/ })).toBeDefined()
  expect(await ui.find({ text: /Recherche/ })).toBeDefined()
  await $.tool.call({ tool: 'WebSearch', tool_use_id: 'w1', agentId: 'agent-1', query: 'svelte routes' } as never)
  expect(await ui.find({ text: /svelte routes/ })).toBeDefined()
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'x', reason: 'answer', agentId: 'agent-1' } as never)
  expect(await ui.find({ text: /Rend son rapport/ })).toBeDefined()
  await ui.unmount()
})

test('/bureau-auto stops the office opening on its own', async ($, on) => {
  const s = await start($, on)
  expect(JSON.stringify(await run($, 'bureau-auto'))).toContain('plus qu’avec /bureau')
  await spawn($, 'Explore', 'Look around')
  expect(s.opened).toBe(0)
})

test('/clear empties the office', async ($, on) => {
  await start($, on)
  await spawn($, 'Explore', 'Look around')
  await $.session.end({ reason: 'clear' } as never)
  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ text: /Iris/ })).toBeUndefined()
  expect(await ui.find({ text: /0 agent/ })).toBeDefined()
  await ui.unmount()
})
