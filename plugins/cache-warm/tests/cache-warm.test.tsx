import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

/** A slash command as the composer sends it. */
const run = ($: Engine, command: string) =>
  $.command.run({ command, args: '', origin: { kind: 'composer' } as never, presentation: { isFullscreen: false, columns: 120 } })

const SURFACES = ['terminal', 'desktop'] as const
const MIN = 60_000
const NOW = Date.UTC(2026, 9, 15, 12)

const usage = (read: number, written: number, uncached = 0) => ({
  input_tokens: uncached,
  output_tokens: 500,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: written,
  model: 'claude-opus-5-5',
})

type Started = { clock: MockClock; toasts: string[]; forks: number }

/** Stands in for the engine beneath the mod, then starts the session. */
async function start($: Engine, on: On): Promise<Started> {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const s: Started = { clock, toasts: [], forks: 0 }
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', async (_$, e) => {
    s.toasts.push(e.text)
    return { value: undefined }
  })
  on('model.fork', async () => {
    s.forks += 1
    return { value: { isAnswered: true as const, text: 'ok', usage: usage(480_000, 0, 20) } }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('classic.SessionStart', async () => ({}) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer, usage: e.usage }))
  // The engine's own band: an empty row the mod must keep under it.
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return s
}

/** One main-thread reply lands: a turn with that usage. */
async function reply($: Engine, read: number, written: number) {
  await $.turn.start({ text: 'hi', turnId: 't' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', usage: usage(read, written) } as never)
}

const band = () => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
})

const footer = () => ({ component: 'SessionMode' as const, props: { modes: [] }, viewport: { columns: 100, rows: 40, isFullscreen: true } })

test('nothing cached: one header line, no keep-warm button', async ($, on) => {
  await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'cache-warm', surface, ...band() })
    expect(await ui.find({ text: /nothing cached yet/ })).toBeDefined()
    expect(await ui.find({ key: 'ping' })).toBeUndefined()
    expect(await ui.find({ key: 'engine-band' })).toBeDefined()
    await ui.unmount()
  }
})

test('a reply warms the cache: time left, hit rate, keep-warm controls', async ($, on) => {
  await start($, on)
  await reply($, 0, 400_000)
  await reply($, 380_000, 20_000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'cache-warm', surface, ...band() })
    expect(await ui.find({ text: /Warm/ })).toBeDefined()
    expect(await ui.find({ text: /60m left of 1h/ })).toBeDefined()
    expect(await ui.find({ text: /95%/ })).toBeDefined()
    expect(await ui.find({ key: 'ping' })).toBeDefined()
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    await ui.unmount()
  }
})

test('the cache cools, warns once, then goes cold', async ($, on) => {
  const s = await start($, on)
  await reply($, 380_000, 20_000)
  await s.clock.advance(50 * MIN)
  const ui = await $.ui.mount({ plugin: 'cache-warm', surface: 'terminal', ...band() })
  expect(await ui.find({ text: /Cooling/ })).toBeDefined()
  expect(await ui.find({ text: /would rewrite/ })).toBeDefined()
  expect(s.toasts.filter(t => t.includes('cools in')).length).toBe(1)
  await s.clock.advance(11 * MIN)
  expect(await ui.find({ text: /Cold/ })).toBeDefined()
  expect(await ui.find({ key: 'ping' })).toBeUndefined()
  expect(s.toasts.some(t => t.includes('went cold'))).toBe(true)
  await ui.unmount()
})

test('Keep warm re-reads the cache through a fork and resets the clock', async ($, on) => {
  const s = await start($, on)
  await reply($, 380_000, 20_000)
  await s.clock.advance(40 * MIN)
  const out = await run($, 'cache-warm-ping')
  expect(JSON.stringify(out)).toContain('kept warm')
  expect(s.forks).toBe(1)
  const ui = await $.ui.mount({ plugin: 'cache-warm', surface: 'terminal', ...band() })
  expect(await ui.find({ text: /60m left/ })).toBeDefined()
  expect(await ui.find({ text: /1 ping/ })).toBeDefined()
  await ui.unmount()
})

test('auto keep-warm pings before the cache lapses, up to its cap', async ($, on) => {
  const s = await start($, on)
  await reply($, 380_000, 20_000)
  await run($, 'cache-warm-auto')
  await s.clock.advance(58 * MIN)
  expect(s.forks).toBe(1)
  // four automatic pings by default, then it waits for the next message
  for (let i = 0; i < 5; i++) await s.clock.advance(58 * MIN)
  expect(s.forks).toBe(4)
  expect(s.toasts.some(t => t.includes('paused'))).toBe(true)
})

test('the Cache button shows and hides the band', async ($, on) => {
  await start($, on)
  await reply($, 380_000, 20_000)
  const mode = await $.ui.mount({ plugin: 'cache-warm', surface: 'desktop', ...footer() } as never)
  expect(await mode.find({ key: 'cache-toggle' })).toBeDefined()
  await mode.press({ key: 'cache-toggle' })
  const hidden = await $.ui.mount({ plugin: 'cache-warm', surface: 'desktop', ...band() })
  expect(await hidden.find({ key: 'ping' })).toBeUndefined()
  await hidden.unmount()
  await mode.press({ key: 'cache-toggle' })
  const shown = await $.ui.mount({ plugin: 'cache-warm', surface: 'desktop', ...band() })
  expect(await shown.find({ key: 'ping' })).toBeDefined()
  await shown.unmount()
  await mode.unmount()
})

test('the chevron and /cache-warm-collapse fold the band to one line', async ($, on) => {
  await start($, on)
  await reply($, 380_000, 20_000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'cache-warm', surface, ...band() })
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ key: 'ping' })).toBeUndefined()
    expect(await ui.find({ key: 'collapse' })).toBeDefined()
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ key: 'ping' })).toBeDefined()
    await ui.unmount()
  }
  expect(JSON.stringify(await run($, 'cache-warm-collapse'))).toContain('folded')
  expect(JSON.stringify(await run($, 'cache-warm-collapse'))).toContain('expanded')
})

test('/clear forgets the cache', async ($, on) => {
  await start($, on)
  await reply($, 380_000, 20_000)
  await $.classic.SessionStart({ source: 'clear' } as never)
  const ui = await $.ui.mount({ plugin: 'cache-warm', surface: 'terminal', ...band() })
  expect(await ui.find({ text: /nothing cached yet/ })).toBeDefined()
  await ui.unmount()
})

test('nothing is drawn with a background or border', async ($, on) => {
  await start($, on)
  await reply($, 380_000, 20_000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'cache-warm', surface, ...band() })
    for (const el of await ui.findAll({ type: 'Box' })) {
      expect(el.props['backgroundColor']).toBeUndefined()
      expect(el.props['borderStyle']).toBeUndefined()
    }
    await ui.unmount()
  }
})
