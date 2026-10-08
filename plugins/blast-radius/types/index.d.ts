// Contract for blast-radius: the values it keeps in $.state.

export type BlastRisk = 'delete' | 'force-push' | 'git-discard' | 'git-clean' | 'branch-delete' | 'migration' | 'sql-drop'

/** critical: irreversible and wide (home folder, .git, SQL drop); high: data loss; medium: usually recoverable. */
export type BlastSeverity = 'critical' | 'high' | 'medium'

/** One line of the preview: a folder and how many files under it, a commit, a changed file. */
export type BlastItem = { label: string; note?: string }

export type HeldCommand = {
  id: string
  command: string
  risk: BlastRisk
  severity: BlastSeverity
  /** One line: what running it does ("delete 340 files (38.2 MB)"). */
  summary: string
  /** Loud warnings above the preview ("Targets your home folder"). */
  warnings: string[]
  /** Whether what it destroys can be got back, and how; null when not known. */
  recovery: string | null
  items: BlastItem[]
  /** How many items there are in all, when more than are listed. */
  total: number
  where: 'pane' | 'band'
  /** Seconds until the hold auto-cancels; null when it waits for a press forever. */
  secondsLeft: number | null
  /** The timeout it started from, for the countdown bar; null when it waits forever. */
  timeoutSeconds: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'blast-radius': {
      held: HeldCommand | null
      /** Commands the person allowed for the rest of the session, exactly as written. */
      allowed: string[]
    }
  }
}
