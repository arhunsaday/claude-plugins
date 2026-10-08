// What a held command would destroy, read with the tools' own dry runs (`git clean -n`, `find` without -delete,
// `git log`, `git status`, `du`). Nothing here changes anything.

import type { BlastItem, BlastSeverity, HeldCommand } from '../types'
import { dangerOf, groupFiles, plural, size, type Found } from './classify'

export type Measured = Pick<HeldCommand, 'summary' | 'warnings' | 'recovery' | 'items' | 'total' | 'severity'>

const MAX_FILES = 5000
const MAX_ITEMS = 40
// Paths the preview can't resolve without running the command: shell variables, command substitution, ~user.
const UNRESOLVED = /[$`]|^~[^/]/
const UNRESOLVED_QUOTED = /[$`~]/ // with quotes around, even ~ and $HOME are unknown

const lines = (s: string) => s.split('\n').filter(l => l.trim() !== '')

/** A path from the folder being deleted (build/chunk-1.js), not the whole path. */
function short(file: string, targets: string[]): string {
  for (const t of targets) {
    const base = t.replace(/\/+$/, '')
    const parent = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : ''
    if (parent && file.startsWith(parent)) return file.slice(parent.length)
  }
  return file.replace(/^\.\//, '')
}

const worst = (a: BlastSeverity, b: BlastSeverity): BlastSeverity =>
  a === 'critical' || b === 'critical' ? 'critical' : a === 'high' || b === 'high' ? 'high' : 'medium'

/** Runs a command (argv, no shell) in a folder and answers its exit code and output; the hooks module wraps $.process.run. */
export type Run = (argv: string[], cwd?: string) => Promise<{ exitCode: number; stdout: string }>

export async function measure(found: Found, io: { home: string; run: Run }): Promise<Measured> {
  const home = io.home
  // With quotes in the command '~' may be literal: don't expand, report it instead.
  const expand = (p: string) => (home && !found.hasQuotes ? p.replace(/^~(?=\/|$)/, home).replace(/\$\{HOME\}|\$HOME\b/g, home) : p)
  const cwd = found.cwd ? expand(found.cwd) : undefined
  const unresolved = found.hasQuotes ? UNRESOLVED_QUOTED : UNRESOLVED
  const at = cwd && !unresolved.test(cwd) ? cwd : undefined
  const run = (argv: string[]) => io.run(argv, at)
  const base = { warnings: [] as string[], recovery: null as string | null, items: [] as BlastItem[], total: 0, severity: found.severity }

  try {
    switch (found.risk) {
      case 'delete': {
        const targets = (found.targets ?? []).map(expand)
        const warnings = dangerOf(targets, home)
        const severity: BlastSeverity = warnings.length > 0 ? 'critical' : found.severity
        const unknown = targets.filter(t => unresolved.test(t))
        if (unknown.length > 0 || (cwd !== undefined && unresolved.test(cwd))) {
          const list = unknown.length > 0 ? unknown : [`cd ${found.cwd}`]
          return {
            ...base,
            severity,
            warnings,
            summary: `can't preview: ${list.length === 1 ? 'a path uses' : `${list.length} paths use`} a shell variable, check it by hand`,
            items: list.map(label => ({ label })),
            total: list.length,
          }
        }
        let files: string[]
        let kb = 0
        if (found.isFind && !found.findArgs) {
          return { ...base, severity, warnings, summary: "delete files (a find with -exec can't be previewed safely)" }
        }
        if (found.findArgs) {
          const r = await run(['find', ...found.findArgs])
          files = lines(r.stdout).slice(0, MAX_FILES).map(f => short(f, targets))
        } else {
          // Unquoted $t expands globs, and nothing else, without running the command.
          const script =
            'shopt -s nullglob dotglob; for t in "$@"; do for p in $t; do [ -e "$p" ] || continue; ' +
            `echo "S $(du -sk "$p" | cut -f1)"; find "$p" -type f | head -n ${MAX_FILES} | sed "s/^/F /"; done; done`
          const r = await run(['bash', '-c', script, 'blast-radius', ...targets])
          const out = r.stdout.split('\n')
          files = out.filter(l => l.startsWith('F ')).map(l => short(l.slice(2), targets))
          kb = out.filter(l => l.startsWith('S ')).reduce((sum, l) => sum + Number(l.slice(2)), 0)
        }
        if (files.length === 0 && kb === 0) return { ...base, severity, warnings, summary: 'delete nothing that exists right now' }
        const count = files.length >= MAX_FILES ? `${MAX_FILES}+ files` : plural(files.length, 'file')
        return {
          ...base,
          severity,
          warnings,
          summary: `delete ${count}${kb > 0 ? ` (${size(kb)})` : ''}`,
          recovery: await recoveryOf(run, targets, files.length),
          items: groupFiles(files),
          total: files.length,
        }
      }

      case 'force-push': {
        const lost = lines((await run(['git', 'log', '--oneline', 'HEAD..@{u}'])).stdout)
        const added = lines((await run(['git', 'log', '--oneline', '@{u}..HEAD'])).stdout)
        const items = [...lost.map(c => ({ label: c, note: 'lost' })), ...added.map(c => ({ label: c, note: 'pushed' }))]
        return {
          ...base,
          severity: lost.length === 0 ? 'medium' : found.severity,
          summary: `overwrite the remote branch: ${plural(lost.length, 'remote commit')} lost, ${added.length} pushed (as of the last fetch)`,
          warnings: lost.length > 0 && !found.isLease ? ['Plain --force: anything pushed since your last fetch is lost too'] : [],
          recovery:
            lost.length === 0
              ? 'No remote commit is lost, as of your last fetch'
              : 'Lost commits survive only in clones that already have them, or your own reflog if you had them locally',
          items: items.slice(0, MAX_ITEMS),
          total: items.length,
        }
      }

      case 'git-discard': {
        const [sub, ...args] = found.git ?? []
        if (sub === 'stash') {
          const stashes = lines((await run(['git', 'stash', 'list'])).stdout)
          const dropped = args[0] === 'clear' ? stashes : stashes.filter(s => s.startsWith(args[1] ?? 'stash@{0}'))
          return {
            ...base,
            summary: dropped.length === 0 ? 'drop nothing: no such stash' : `drop ${plural(dropped.length, 'stash')}`,
            recovery: 'A dropped stash can still be found with `git fsck --unreachable` until git garbage-collects it',
            items: dropped.slice(0, MAX_ITEMS).map(label => ({ label })),
            total: dropped.length,
          }
        }
        const paths = args.includes('--') ? args.slice(args.indexOf('--') + 1) : args.filter(a => !a.startsWith('-'))
        const ref = sub === 'reset' ? args.find(a => !a.startsWith('-')) : undefined
        const scope = sub === 'reset' ? [] : ['--', ...paths.filter(p => p !== ref)]
        const changed = lines((await run(['git', 'status', '--porcelain', '--untracked-files=no', ...scope])).stdout)
        const stat = (await run(['git', 'diff', '--shortstat', 'HEAD', ...scope])).stdout.trim()
        const commits = ref ? lines((await run(['git', 'log', '--oneline', `${ref}..HEAD`])).stdout) : []
        const items = [
          ...changed.map(l => ({ label: l.slice(3), note: l.slice(0, 2).trim() === 'D' ? 'deleted' : 'edited' })),
          ...commits.map(c => ({ label: c, note: 'leaves the branch' })),
        ]
        const parts = [
          changed.length > 0 ? `discard uncommitted edits in ${plural(changed.length, 'file')}` : 'discard no uncommitted edits',
          ...(commits.length > 0 ? [`move the branch back ${plural(commits.length, 'commit')}`] : []),
        ]
        return {
          ...base,
          severity: changed.length === 0 && commits.length === 0 ? 'medium' : found.severity,
          summary: `${parts.join(', ')}${stat ? ` (${stat.replace(/ changed|\(\+\)|\(-\)/g, '')})` : ''}`,
          recovery:
            changed.length > 0
              ? `Uncommitted edits are gone for good${commits.length > 0 ? '; the commits stay in `git reflog` for about 90 days' : ''}`
              : commits.length > 0
                ? 'The commits stay in `git reflog` for about 90 days'
                : null,
          items: items.slice(0, MAX_ITEMS),
          total: items.length,
        }
      }

      case 'git-clean': {
        const [, ...args] = found.git ?? []
        // The same flags without -f, plus -n: git's own dry run.
        const dry = args.map(a => (/^-[a-zA-Z]+$/.test(a) ? a.replace(/f/g, '') : a)).filter(a => a !== '-' && a !== '--force')
        const removed = lines((await run(['git', 'clean', '-n', ...dry])).stdout).map(l => l.replace(/^Would remove /, ''))
        const withIgnored = args.some(a => /^-[a-zA-Z]*[xX]/.test(a))
        return {
          ...base,
          summary: removed.length === 0 ? 'delete nothing: no untracked files' : `delete ${plural(removed.length, 'untracked path')}`,
          warnings: withIgnored ? ['-x also deletes ignored files: .env, node_modules, build output'] : [],
          recovery: removed.length > 0 ? 'Untracked files are not in git: they are gone for good' : null,
          items: groupFiles(removed),
          total: removed.length,
        }
      }

      case 'branch-delete': {
        const [, ...args] = found.git ?? []
        const branches = args.filter(a => !a.startsWith('-'))
        const items: BlastItem[] = []
        const warnings: string[] = []
        let severity: BlastSeverity = found.severity
        for (const b of branches) {
          const unmerged = lines((await run(['git', 'log', '--oneline', `HEAD..${b}`])).stdout)
          const remotes = lines((await run(['git', 'branch', '-r', '--contains', b])).stdout)
          items.push({ label: b, note: `${plural(unmerged.length, 'commit')} not in HEAD${remotes.length > 0 ? ', on the remote' : ', local only'}` })
          if (unmerged.length > 0 && remotes.length === 0) {
            warnings.push(`${b} has ${plural(unmerged.length, 'commit')} that exist nowhere else`)
            severity = worst(severity, 'high')
          }
        }
        return {
          ...base,
          severity,
          summary: `delete ${branches.length} branch${branches.length === 1 ? '' : 'es'}`,
          warnings,
          recovery: 'A deleted branch can be brought back from `git reflog` for about 90 days',
          items,
          total: items.length,
        }
      }

      case 'migration': {
        const status = lines((await run(['git', 'status', '--porcelain'])).stdout)
        const touched = status.filter(l => /migrat|schema|prisma|supabase|drizzle|alembic|db\//i.test(l))
        return {
          ...base,
          summary: found.severity === 'critical' ? 'reset the database: every row is deleted' : 'change the database schema (no preview)',
          warnings: found.severity === 'critical' ? [`${found.quote ?? 'This command'} drops the data, not only the schema`] : [],
          recovery: found.severity === 'critical' ? 'Only a backup brings the data back' : 'Most migrations can be rolled back; data dropped by one cannot',
          items: touched.map(l => ({ label: l.slice(3), note: 'uncommitted' })).slice(0, MAX_ITEMS),
          total: touched.length,
        }
      }

      case 'sql-drop': {
        const statements = (found.quote ?? '').split('; ').filter(Boolean)
        return {
          ...base,
          summary: `run ${plural(statements.length, 'destructive SQL statement')}`,
          recovery: 'Only a backup brings dropped or truncated data back',
          items: statements.map(label => ({ label })),
          total: statements.length,
        }
      }
    }
  } catch {
    return { ...base, summary: `run a destructive ${found.risk} command (could not measure it)` }
  }
}

/** How many of the deleted files git could restore. */
async function recoveryOf(run: (argv: string[]) => ReturnType<Run>, targets: string[], files: number): Promise<string | null> {
  try {
    const r = await run(['git', 'ls-files', '--', ...targets])
    if (r.exitCode !== 0) return 'Not in a git repository: nothing to restore them from'
    const tracked = Math.min(files, lines(r.stdout).length)
    const untracked = files - tracked
    if (tracked === 0) return 'None are tracked by git: they are gone for good'
    if (untracked === 0) return `All are tracked by git: \`git checkout -- ${targets.join(' ')}\` brings them back`
    return `${tracked} tracked by git (restorable) · ${untracked} untracked (gone for good)`
  } catch {
    return null
  }
}
