import { expect, test } from 'claude-code/testing'

test('the command toggles the band', async $ => {
  const hidden = await $.command.run({ command: 'example-mod' })
  expect(JSON.stringify(hidden)).toContain('hidden')
  const shown = await $.command.run({ command: 'example-mod' })
  expect(JSON.stringify(shown)).toContain('shown')
})
