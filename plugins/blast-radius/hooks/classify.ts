// Which commands are destructive, read from the command text alone: no `$`, nothing runs.

import type { BlastRisk, BlastSeverity } from '../types'

export type Found = {
  risk: BlastRisk
  severity: BlastSeverity
  /** The folder the command runs in, from a `cd` or `git -C` before it. */
  cwd?: string
  /** rm: the paths; find: the roots. */
  targets?: string[]
  isFind?: boolean
  /** find … -delete: the same search without -delete, for a dry run; absent when it can't run safely (-exec). */
  findArgs?: string[]
  /** The command had quotes: '~' and '$HOME' may be literal, so they are not expanded. */
  hasQuotes?: boolean
  /** git: the subcommand and its arguments (`['clean', '-fdx']`). */
  git?: string[]
  /** Statements or tool words worth listing as they are (SQL, a migration). */
  quote?: string
  isLease?: boolean
}

const MIGRATION =
  /\b(prisma\s+(migrate|db\s+push)|supabase\s+(db\s+(reset|push)|migration\s+up)|drizzle-kit\s+(push|migrate)|knex\s+migrate|sequelize(-cli)?\s+db:migrate|rails\s+db:(migrate|reset|drop)|rake\s+db:(migrate|reset|drop)|alembic\s+(upgrade|downgrade)|typeorm\s+migration:run|django-admin\s+migrate|manage\.py\s+(migrate|flush))\b/
/** A migration that throws the data away rather than changing the schema. */
const DATA_RESET = /\b(prisma\s+migrate\s+reset|supabase\s+db\s+reset|(rails|rake)\s+db:(reset|drop)|manage\.py\s+flush|--force-reset|--accept-data-loss)\b/
const SQL_CLIENT = /\b(psql|mysql|mariadb|sqlite3|duckdb|clickhouse(-client)?|pgcli|mycli|cockroach\s+sql)\b/
const SQL_DROP = /\b(drop\s+(table|database|schema|view)\b[^;'"]*|truncate(\s+table)?\s+[\w."]+|delete\s+from\s+[\w."]+\s*(;|$|['"]))/gi

/** Shell-like words: quotes kept together, the quotes themselves dropped. */
export function split(text: string): string[] {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^["']|["']$/g, ''))
}

const hasFlag = (args: string[], short: string, long?: string) =>
  args.some(a => (long !== undefined && a === long) || (/^-[a-zA-Z]+$/.test(a) && a.includes(short)))

/** The git subcommand and its arguments, past global options (`-C dir`, `-c k=v`); the -C folder as cwd. */
function gitWords(words: string[]): { sub: string; args: string[]; cwd?: string } | null {
  if (words[0] !== 'git') return null
  let cwd: string | undefined
  let i = 1
  while (i < words.length && words[i]!.startsWith('-')) {
    if (words[i] === '-C') cwd = words[i + 1]
    i += words[i] === '-C' || words[i] === '-c' ? 2 : 1
  }
  const sub = words[i]
  return sub ? { sub, args: words.slice(i + 1), cwd } : null
}

function classifyGit(words: string[], cwd: string | undefined): Found | null {
  const g = gitWords(words)
  if (!g) return null
  const { sub, args } = g
  const at = g.cwd ?? cwd
  const git = [sub, ...args]
  if (sub === 'push' && args.some(a => a === '-f' || a.startsWith('--force') || /^\+/.test(a))) {
    const isLease = args.some(a => a.startsWith('--force-with-lease') || a.startsWith('--force-if-includes')) && !args.some(a => a === '-f' || a === '--force')
    return { risk: 'force-push', severity: isLease ? 'medium' : 'high', cwd: at, git, isLease }
  }
  if (sub === 'reset' && args.includes('--hard')) return { risk: 'git-discard', severity: 'high', cwd: at, git }
  if (sub === 'checkout' && !hasFlag(args, 'b') && !hasFlag(args, 'B') && (args.includes('--') || args.includes('.'))) {
    return { risk: 'git-discard', severity: 'high', cwd: at, git }
  }
  if (sub === 'restore') {
    const isStagedOnly = (args.includes('--staged') || hasFlag(args, 'S')) && !(args.includes('--worktree') || hasFlag(args, 'W'))
    if (!isStagedOnly) return { risk: 'git-discard', severity: 'high', cwd: at, git }
  }
  if (sub === 'stash' && (args[0] === 'drop' || args[0] === 'clear')) return { risk: 'git-discard', severity: 'high', cwd: at, git }
  if (sub === 'clean' && (args.includes('--force') || hasFlag(args, 'f')) && !(args.includes('--dry-run') || hasFlag(args, 'n'))) {
    return { risk: 'git-clean', severity: 'high', cwd: at, git }
  }
  if (sub === 'branch' && (hasFlag(args, 'D') || (args.includes('--delete') && args.includes('--force')))) {
    return { risk: 'branch-delete', severity: 'medium', cwd: at, git }
  }
  return null
}

/** Which destructive kind a command is, if any, looking at each part of a compound command. */
export function classify(command: string): Found | null {
  let cwd: string | undefined
  const hasQuotes = /['"\\]/.test(command)
  for (const raw of command.split(/&&|\|\||;|\n|\|/)) {
    const part = raw.trim()
    const words = split(part)
    const first = words[0] === 'sudo' ? 1 : 0
    const head = words[first]
    if (head === 'cd' && words[first + 1]) cwd = words[first + 1]

    if (head === 'rm') {
      const args = words.slice(first + 1)
      const isRecursive = args.some(f => f === '--recursive' || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)))
      if (isRecursive) {
        return { risk: 'delete', severity: 'high', cwd, targets: args.filter(a => !a.startsWith('-')), ...(hasQuotes ? { hasQuotes } : {}) }
      }
    }

    if (head === 'find' && words.includes('-delete')) {
      const args = words.slice(first + 1)
      const firstExpr = args.findIndex(a => a.startsWith('-') || a === '(' || a === '!')
      const roots = firstExpr === -1 ? args : args.slice(0, firstExpr)
      const isPreviewable = !args.some(a => /^-(exec|execdir|ok|okdir|fprint|fls)$/.test(a))
      return {
        risk: 'delete',
        severity: 'high',
        cwd,
        isFind: true,
        targets: roots.length > 0 ? roots : ['.'],
        ...(isPreviewable ? { findArgs: args.filter(a => a !== '-delete') } : {}),
        ...(hasQuotes ? { hasQuotes } : {}),
      }
    }

    const git = classifyGit(words.slice(first), cwd)
    if (git) return git

    if (SQL_CLIENT.test(part)) {
      const drops = part.match(SQL_DROP)
      if (drops) return { risk: 'sql-drop', severity: 'critical', cwd, quote: drops.map(s => s.trim()).join('; ') }
    }

    const migration = part.match(MIGRATION)
    if (migration) {
      const isReset = DATA_RESET.test(part)
      return { risk: 'migration', severity: isReset ? 'critical' : 'medium', cwd, quote: migration[0] }
    }
  }
  return null
}

/** The timeoutSeconds option as whole seconds: a number or a numeric string, 0 to wait forever. */
export function timeoutFrom(value: unknown, fallback = 60): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return fallback
  return Math.ceil(n)
}

/** Warnings for a deletion that reaches far: the root, the home folder, a .git folder, everything here. */
export function dangerOf(targets: string[], home: string): string[] {
  const out = new Set<string>()
  for (const t of targets) {
    const p = t.replace(/\/+$/, '') || '/'
    const bare = p.replace(/\/\*$/, '')
    if (p === '/' || p === '/*' || bare === '') out.add('Targets the filesystem root')
    else if (home && (bare === home || p === '~' || p === '~/*')) out.add('Targets your whole home folder')
    else if (/(^|\/)\.git$/.test(p)) out.add("Deletes a .git folder: the repository's whole history")
    else if (p === '.' || p === '*' || p === './*' || p === '.*') out.add('Deletes everything in the current folder')
    else if (p === '..' || p.startsWith('../') && p.split('/').every(s => s === '..' || s === '*')) out.add('Reaches into the parent folder')
  }
  return [...out]
}

/** Files grouped by the folder they sit in, two levels deep, biggest first: what a deletion reaches. */
export function groupFiles(files: string[], max = 8): { label: string; note: string }[] {
  if (files.length <= max) return files.map(f => ({ label: f, note: '' }))
  const counts = new Map<string, number>()
  for (const f of files) {
    const parts = f.split('/')
    const key = parts.length > 2 ? `${parts.slice(0, 2).join('/')}/` : parts.length === 2 ? `${parts[0]}/` : f
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  // One folder holds them all: grouping would say nothing, so list the files themselves.
  if (counts.size <= 1) return files.slice(0, max).map(f => ({ label: f, note: '' }))
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([label, n]) => ({ label, note: n === 1 && !label.endsWith('/') ? '' : `${n} file${n === 1 ? '' : 's'}` }))
}

export function size(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
