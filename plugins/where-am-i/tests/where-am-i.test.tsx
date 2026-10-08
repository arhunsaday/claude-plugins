import { describe, expect, mock, test } from 'claude-code/testing'

import { clip, describe as label, isTrivial, parseRecap } from '../hooks/recap'

const band = (isWorking = false) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})
const cmd = (command: string) => ({ command, args: '', origin: { kind: 'composer' } as never, presentation: { isFullscreen: false, columns: 120 } })
const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))

// Stands for the engine beneath the mod; counts the model calls.
function engine(on: any, reply: string, calls = { model: 0 }) {
  mock.clock(on)
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', () => {
    calls.model += 1
    return { value: { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1 } } }
  })
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build the mods', toolUses: [] }] }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="below">band below</Text>
  })
  return calls
}

const RECAP = '```json\n{"goal":"Ship 3 mods","now":"built Where Am I","waiting":"you to test it","next":"Rulebook Guard"}\n```'

async function oneTurn($: any, text = 'ship all 3', answer = 'done') {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  await $.prompt.submit({ text } as any)
  await $.tool.call({ tool: 'Write', file_path: '/work/a/b.ts', content: 'x' } as any)
  await $.turn.complete({ reason: 'answer', answer, durationMs: 1 } as any)
  await wait()
}

describe('helpers', () => {
  test('labels tool calls the way a person would', () => {
    expect(label({ tool: 'Edit', file_path: '/x/hooks/view.tsx' })).toBe('editing hooks/view.tsx')
    expect(label({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })).toBe('running Run the tests')
    expect(label({ tool: 'mcp__github__create_pr' })).toBe('using github create pr')
  })

  test('reads the recap through a code fence and clips long fields', () => {
    expect(parseRecap(RECAP)).toEqual({ goal: 'Ship 3 mods', now: 'built Where Am I', waiting: 'you to test it', next: 'Rulebook Guard' })
    expect(parseRecap('no json')).toBeNull()
    expect(clip('a '.repeat(60)).length).toBeLessThanOrEqual(70)
  })

  test('skips the model on a short turn with no tools, once a recap exists', () => {
    expect(isTrivial(0, 'thanks!', true)).toBe(true)
    expect(isTrivial(0, 'thanks!', false)).toBe(false)
    expect(isTrivial(2, 'done', true)).toBe(false)
  })
})

describe('the band', () => {
  test('draws the recap above what was already there', async ($, on) => {
    engine(on, RECAP)
    await oneTurn($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'where-am-i', surface, ...band() } as any)
      expect(await ui.find({ type: 'Text', text: /^Ship 3 mods$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^built Where Am I$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Rulebook Guard$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /⏳ you to test it/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('shows the message as the goal until the first recap, and what Claude is doing', async ($, on) => {
    engine(on, 'not json')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: 'make the panel prettier' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/work/hooks/view.tsx', old_string: 'a', new_string: 'b' } as any)
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...band(true) } as any)
    expect(await ui.find({ type: 'Text', text: /^make the panel prettier$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^editing hooks\/view\.tsx$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a trivial turn makes no model call', async ($, on) => {
    const calls = engine(on, RECAP)
    await oneTurn($)
    expect(calls.model).toBe(1)
    await $.prompt.submit({ text: 'thanks' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'You are welcome.', durationMs: 1 } as any)
    await wait()
    expect(calls.model).toBe(1)
  })

  test('the chevron and /where-collapse fold it to one line', async ($, on) => {
    engine(on, RECAP)
    await oneTurn($)
    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'terminal', ...band() } as any)
    expect(await ui.find({ type: 'Text', text: /^Rulebook Guard$/ })).toBeDefined()
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ type: 'Text', text: /^Rulebook Guard$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Ship 3 mods$/ })).toBeDefined()
    await ui.unmount()
    const r: any = await $.command.run(cmd('where-collapse'))
    expect(r.text).toMatch(/expanded/)
  })

  test('/where answers a longer recap', async ($, on) => {
    engine(on, '- goal: ship\n- next: test')
    await oneTurn($)
    const r: any = await $.command.run(cmd('where'))
    expect(r.text).toMatch(/goal: ship/)
  })
})
