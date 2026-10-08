// example-mod: a one-line band above the prompt, toggled by /example-mod.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isOpen = atom({ plugin: 'example-mod', key: 'isOpen' } as const, true)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'example-mod', description: 'Show or hide the example band' })
    return next(e)
  })

  on('command.run', { command: 'example-mod' }, async $ => {
    const was = await read($, isOpen)
    await update($, isOpen, () => !was)
    return { text: was ? 'Example band hidden.' : 'Example band shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOpen))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const below = await next(e)
    const mine = <Text dimColor>example-mod is running</Text>
    return below ? (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    ) : (
      mine
    )
  })
}
