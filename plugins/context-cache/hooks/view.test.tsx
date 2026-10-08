import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

/** A slash command as the composer sends it. */
const run = ($: Engine, command: string) =>
  $.command.run({ command, args: '', origin: { kind: 'composer' } as never, presentation: { isFullscreen: false, columns: 120 } })

const SURFACES = ['terminal', 'desktop'] as const
const MIN = 60_000
const NOW = Date.UTC(2026, 9, 8, 12)
const iso = (ms: number) => new Date(ms).toISOString()

/** Stands in for the engine beneath the plugin: a session at 484k of 1M with two limit windows, then starts it. */
async function start($: Engine, on: On) {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.surfaces', async () => ({ value: [] }))
  on('session.authorize', async () => ({ value: null as never }))
  on('session.messages', async () => ({ value: [] as never }))
  on('session.usage', async () => ({ value: {
    startedAt: NOW - 30 * MIN,
    context: {
      tokens: 484_000,
      window: 1_000_000,
      breakdown: {
        categories: [
          { name: 'System prompt', tokens: 20_000, color: '', isDeferred: false, kind: 'used' },
          { name: 'System tools', tokens: 30_000, color: '', isDeferred: false, kind: 'used' },
          { name: 'Messages', tokens: 434_000, color: '', isDeferred: false, kind: 'used' },
        ],
        totalTokens: 484_000,
        autoCompactThreshold: 800_000,
        isAutoCompactEnabled: true,
      } as never,
    },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 34, resetsAt: iso(NOW + 120 * MIN) },
      { kind: 'seven_day', percentUsed: 26, resetsAt: iso(NOW + 4 * 1440 * MIN) },
    ],
  } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  // The engine's own band: an empty row the panel must keep under it.
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await run($, 'cache-refresh')
}

const band = (maxRows = 12) => ({
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: maxRows },
    view: {},
  },
})

test('the chevron folds the panel to one line and opens it again', async ($, on) => {
  await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-cache', surface, ...band() })

    expect(await ui.find({ key: 'clear' })).toBeDefined()
    expect(await ui.find({ key: 'engine-band' })).toBeDefined()
    expect(await ui.find({ text: /Session/ })).toBeDefined()
    expect(await ui.find({ text: /Free/ })).toBeDefined()

    await ui.press({ key: 'collapse' })
    expect(await ui.find({ key: 'clear' })).toBeUndefined()
    expect(await ui.find({ text: /Free/ })).toBeUndefined()
    expect(await ui.find({ key: 'collapse' })).toBeDefined()
    expect(await ui.find({ text: /34%/ })).toBeDefined()

    await ui.press({ key: 'collapse' })
    expect(await ui.find({ key: 'clear' })).toBeDefined()
    await ui.unmount()
  }
})

test('/cache-collapse toggles the same state', async ($, on) => {
  await start($, on)
  const folded = await run($, 'cache-collapse')
  expect(JSON.stringify(folded)).toContain('collapsed')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-cache', surface, ...band() })
    expect(await ui.find({ key: 'clear' })).toBeUndefined()
    await ui.unmount()
  }
  const opened = await run($, 'cache-collapse')
  expect(JSON.stringify(opened)).toContain('expanded')
})

test('a band too short for the panel draws the one-line summary', async ($, on) => {
  await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-cache', surface, ...band(3) })
    expect(await ui.find({ key: 'clear' })).toBeUndefined()
    expect(await ui.find({ key: 'collapse' })).toBeDefined()
    await ui.unmount()
  }
})

test('nothing is drawn with a background or border', async ($, on) => {
  await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'context-cache', surface, ...band() })
    for (const el of await ui.findAll({ type: 'Box' })) {
      expect(el.props['backgroundColor']).toBeUndefined()
      expect(el.props['borderStyle']).toBeUndefined()
    }
    await ui.unmount()
  }
})
