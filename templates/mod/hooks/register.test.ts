import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

/** A slash command as the composer sends it. */
const run = ($: Engine, command: string) =>
  $.command.run({ command, args: '', origin: { kind: 'composer' } as never, presentation: { isFullscreen: false, columns: 120 } })

test('the command toggles the band', async $ => {
  const hidden = await run($, 'example-mod')
  expect(JSON.stringify(hidden)).toContain('hidden')
  const shown = await run($, 'example-mod')
  expect(JSON.stringify(shown)).toContain('shown')
})
