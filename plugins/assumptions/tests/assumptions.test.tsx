import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOOL = 'mcp__assumptions__assumption_log'
const SURFACES = ['terminal', 'desktop'] as const

const run = ($: Engine, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' } as never, presentation: { isFullscreen: false, columns: 120 } })

const log = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, tool_use_id: `t${Math.random()}`, ...input } as never)

type Started = { submitted: string[]; tools: { name: string; isDeferred?: unknown }[]; settle: () => Promise<void> }

/** Stands in for the engine beneath the mod, then starts the session. */
async function start($: Engine, on: On): Promise<Started> {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 15, 12) })
  mock.store(on)
  const s: Started = { submitted: [], tools: [], settle: () => clock.settle() }
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => {
    s.tools.push(e as never)
    return { value: { tool: `mcp__assumptions__${e.name}` } }
  })
  on('prompt.submit', async (_$, e) => {
    s.submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async () => ({ sessionId: 's' }) as never)
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return s
}

const band = (isWorking = false) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
})

async function logThree($: Engine) {
  await log($, { text: 'Timeout is 30 s', where: 'api/client.ts' })
  await log($, { items: [{ text: 'Retries twice on 5xx', where: 'api/client.ts' }, { text: 'Dates shown in UTC' }] })
}

test('the log tool is in the tool list, not behind ToolSearch', async ($, on) => {
  const s = await start($, on)
  const tool = s.tools.find(t => t.name === 'assumption_log')
  expect(tool).toBeDefined()
  expect(tool!.isDeferred).toBe(false)
})

test('logging numbers each guess once and refuses an empty call', async ($, on) => {
  await start($, on)
  expect(JSON.stringify(await log($, { text: 'Timeout is 30 s', where: 'api/client.ts' }))).toContain('logged #1')
  expect(JSON.stringify(await log($, { items: [{ text: 'Retries twice' }, { text: 'Dates in UTC' }] }))).toContain('logged #2, #3')
  expect(JSON.stringify(await log($, { text: 'timeout is 30 s', where: 'api/client.ts' }))).toContain('already logged')
  expect(JSON.stringify(await log($, { text: '   ' }))).toContain('assumption_log: give')
})

test('the strip waits for the turn to end, then starts folded', async ($, on) => {
  await start($, on)
  await logThree($)
  for (const surface of SURFACES) {
    const working = await $.ui.mount({ plugin: 'assumptions', surface, ...band(true) })
    expect(await working.find({ text: /assumptions/ })).toBeUndefined()
    await working.unmount()
    const ui = await $.ui.mount({ plugin: 'assumptions', surface, ...band() })
    expect(await ui.find({ text: /Claude made 3 assumptions/ })).toBeDefined()
    expect(await ui.find({ text: /3 to check/ })).toBeDefined()
    expect(await ui.find({ key: 'right-1' })).toBeUndefined()
    expect(await ui.find({ key: 'collapse' })).toBeDefined()
    expect(await ui.find({ key: 'engine-band' })).toBeDefined()
    await ui.unmount()
  }
})

test('marking one wrong sends a fix prompt that keeps the ones marked right', async ($, on) => {
  const s = await start($, on)
  await logThree($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'assumptions', surface, ...band() })
    if (!(await ui.find({ key: 'right-1' }))) await ui.press({ key: 'collapse' })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'assumptions', surface: 'desktop', ...band() })
  await ui.press({ key: 'right-1' })
  expect(await ui.find({ text: /2 to check/ })).toBeDefined()
  await ui.press({ key: 'wrong-2' })
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('#2')
  expect(s.submitted[0]).toContain('Retries twice on 5xx')
  expect(s.submitted[0]).toContain('Keep these')
  expect(s.submitted[0]).toContain('#1 "Timeout is 30 s"')
  expect(s.submitted[0]).not.toContain('#3')
  expect(await ui.find({ text: /fix sent/ })).toBeDefined()
  expect(await ui.find({ key: 'wrong-2' })).toBeUndefined()
  await ui.unmount()
})

test('All right and Clear checked', async ($, on) => {
  await start($, on)
  await logThree($)
  await run($, 'assumptions-collapse')
  const ui = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', ...band() })
  await ui.press({ key: 'all-right' })
  expect(await ui.find({ text: /all checked/ })).toBeDefined()
  expect(await ui.find({ key: 'all-right' })).toBeUndefined()
  await ui.press({ key: 'clear-checked' })
  expect(await ui.find({ text: /assumptions/ })).toBeUndefined()
  await ui.unmount()
})

// A plugin's prompt runs once the session is idle, after the command that sent it; the kit does not deliver it here,
// so this test checks the verdicts and the button test above checks the prompt itself.
test('commands mark by number, and a wrong one stays final', async ($, on) => {
  await start($, on)
  await logThree($)
  expect(JSON.stringify(await run($, 'assumptions-right', '1 3'))).toContain('#3 marked right')
  expect(JSON.stringify(await run($, 'assumptions-wrong', '#2'))).toContain('#2 marked wrong')
  expect(JSON.stringify(await run($, 'assumptions-wrong', '2'))).toContain('already marked wrong')
  expect(JSON.stringify(await run($, 'assumptions-right', '2'))).toContain('already marked wrong')
  expect(JSON.stringify(await run($, 'assumptions-wrong', '9'))).toContain('No assumption #9')
  expect(JSON.stringify(await run($, 'assumptions-clear'))).toContain('3 checked')
})

test('/clear empties the list', async ($, on) => {
  await start($, on)
  await logThree($)
  await $.session.end({ reason: 'clear' } as never)
  const ui = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', ...band() })
  expect(await ui.find({ text: /assumptions/ })).toBeUndefined()
  await ui.unmount()
})

test('nothing is drawn with a background or border', async ($, on) => {
  await start($, on)
  await logThree($)
  await run($, 'assumptions-collapse')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'assumptions', surface, ...band() })
    for (const el of await ui.findAll({ type: 'Box' })) {
      expect(el.props['backgroundColor']).toBeUndefined()
      expect(el.props['borderStyle']).toBeUndefined()
    }
    await ui.unmount()
  }
})
