import { describe, expect, mock, test } from 'claude-code/testing'

import { classify, dangerOf, groupFiles, timeoutFrom } from '../hooks/classify'

const PANE = { component: 'Pane', requestId: 'blast-radius', props: { title: 'Blast Radius', isFocused: true, bodyColumns: 100, placement: 'dock' } }

const wait = (ms = 5) => new Promise(done => (globalThis as any).setTimeout(done, ms))

// Stands for the engine beneath the mod: tools run, a 9-file build folder (7 tracked by git), panes that open.
function engine(on: any, ran: string[], { surfaces = ['terminal'], argvs = [] as string[][] } = {}) {
  mock.clock(on)
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('tool.call', (_$: any, e: any) => {
    ran.push(e.command)
    return { result: {}, text: 'ok' }
  })
  on('process.run', async (_$: any, e: any) => {
    const argv: string[] = e.argv
    argvs.push(argv)
    if (argv[0] === 'sleep') await wait()
    let stdout = ''
    if (argv[0] === 'bash') stdout = ['S 1126', ...Array.from({ length: 9 }, (_, i) => `F build/chunk-${i}.js`)].join('\n')
    if (argv[0] === 'git' && argv[1] === 'ls-files') stdout = Array.from({ length: 7 }, (_, i) => `build/chunk-${i}.js`).join('\n')
    if (argv[0] === 'git' && argv[1] === 'clean') stdout = 'Would remove .env\nWould remove node_modules/\n'
    if (argv[0] === 'git' && argv[1] === 'log' && argv[3] === 'HEAD..@{u}') stdout = 'abc1234 fix the thing\n'
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
}

// Mounts the pane until a command is held (the hold loop runs on its own).
async function heldPane($: any) {
  for (let i = 0; i < 80; i++) {
    const ui = await $.ui.mount({ plugin: 'blast-radius', surface: 'terminal', ...PANE })
    if (await ui.find({ key: 'cancel' })) return ui
    await ui.unmount()
    await wait()
  }
  throw new Error('nothing was held')
}

describe('classify', () => {
  test('finds the destructive commands and leaves the rest', () => {
    expect(classify('rm -rf build')?.risk).toBe('delete')
    expect(classify('cd web && rm -r dist')).toMatchObject({ risk: 'delete', cwd: 'web', targets: ['dist'] })
    expect(classify('find . -name "*.log" -delete')).toMatchObject({ risk: 'delete', isFind: true, findArgs: ['.', '-name', '*.log'] })
    expect(classify('find . -name x -exec rm {} ; -delete')?.findArgs).toBeUndefined()
    expect(classify('git push --force origin main')).toMatchObject({ risk: 'force-push', severity: 'high' })
    expect(classify('git push --force-with-lease')).toMatchObject({ risk: 'force-push', severity: 'medium' })
    expect(classify('git reset --hard HEAD~2')?.risk).toBe('git-discard')
    expect(classify('git checkout -- src/a.ts')?.risk).toBe('git-discard')
    expect(classify('git restore .')?.risk).toBe('git-discard')
    expect(classify('git stash clear')?.risk).toBe('git-discard')
    expect(classify('git -C app clean -fdx')).toMatchObject({ risk: 'git-clean', cwd: 'app' })
    expect(classify('git branch -D old-thing')?.risk).toBe('branch-delete')
    expect(classify(`psql -c "DROP TABLE users"`)).toMatchObject({ risk: 'sql-drop', severity: 'critical' })
    expect(classify('npx prisma migrate deploy')).toMatchObject({ risk: 'migration', severity: 'medium' })
    expect(classify('npx prisma migrate reset --force')).toMatchObject({ risk: 'migration', severity: 'critical' })

    expect(classify('rm file.txt')).toBeNull()
    expect(classify('git push origin main')).toBeNull()
    expect(classify('git restore --staged a.ts')).toBeNull()
    expect(classify('git clean -n')).toBeNull()
    expect(classify('git checkout -b feature')).toBeNull()
    expect(classify('git branch -d merged')).toBeNull()
    expect(classify('ls -la && echo rm -rf')).toBeNull()
    expect(classify('echo "DROP TABLE x"')).toBeNull()
  })

  test('flags deletions that reach far', () => {
    expect(dangerOf(['/home/me'], '/home/me')).toEqual(['Targets your whole home folder'])
    expect(dangerOf(['/'], '/home/me')).toEqual(['Targets the filesystem root'])
    expect(dangerOf(['repo/.git'], '/home/me')[0]).toMatch(/\.git folder/)
    expect(dangerOf(['build'], '/home/me')).toEqual([])
  })

  test('groups many files by folder, lists a few as they are', () => {
    expect(groupFiles(['a.js', 'b.js'])).toEqual([{ label: 'a.js', note: '' }, { label: 'b.js', note: '' }])
    const many = [...Array.from({ length: 6 }, (_, i) => `build/assets/${i}.js`), ...Array.from({ length: 4 }, (_, i) => `dist/${i}.js`)]
    expect(groupFiles(many, 3)).toEqual([
      { label: 'build/assets/', note: '6 files' },
      { label: 'dist/', note: '4 files' },
    ])
  })

  test('reads the timeout option', () => {
    expect(timeoutFrom(undefined)).toBe(60)
    expect(timeoutFrom('0')).toBe(0)
    expect(timeoutFrom(2.5)).toBe(3)
  })
})

describe('the hold', () => {
  test('Cancel refuses the command and says what it would have done', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /Would delete 9 files \(1\.1 MB\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /7 tracked by git \(restorable\) · 2 untracked/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /build\/chunk-0\.js/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    const r: any = await call
    expect(r.deny).toMatch(/^blast-radius: the user pressed Cancel on this command\. It would delete 9 files/)
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test('Proceed runs the command as written', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    await ui.press({ key: 'proceed' })
    await call
    expect(ran).toEqual(['rm -rf build'])
    await ui.unmount()
  })

  test('Allow this session lets the same command through from then on', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    const first = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    await ui.press({ key: 'allow' })
    await first
    await ui.unmount()
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    expect(ran).toEqual(['rm -rf build', 'rm -rf build'])
  })

  test("git clean is previewed with git's own dry run, never with -f", async ($, on) => {
    const ran: string[] = []
    const argvs: string[][] = []
    engine(on, ran, { argvs })
    const call = $.tool.call({ tool: 'Bash', command: 'git clean -fdx' } as any)
    const ui = await heldPane($)
    expect(argvs.find(a => a[1] === 'clean')).toEqual(['git', 'clean', '-n', '-dx'])
    expect(await ui.find({ type: 'Text', text: /Would delete 2 untracked paths/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /also deletes ignored files/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })

  test('a force push lists the remote commits it drops', async ($, on) => {
    engine(on, [])
    const call = $.tool.call({ tool: 'Bash', command: 'git push --force' } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /1 remote commit lost/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /abc1234 fix the thing/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })

  test('with no screen it cancels at once', async ($, on) => {
    const ran: string[] = []
    engine(on, ran, { surfaces: [] })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    expect(r.deny).toMatch(/no screen/)
    expect(ran).toEqual([])
  })

  test('safe commands pass untouched', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    await $.tool.call({ tool: 'Bash', command: 'ls -la' } as any)
    expect(ran).toEqual(['ls -la'])
  })
})
