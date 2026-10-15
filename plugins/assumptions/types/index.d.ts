// Contract for assumptions: the values it keeps in $.state.

/** What the person said about a guess: not looked at yet, confirmed, or wrong. */
export type AssumptionVerdict = 'unchecked' | 'right' | 'wrong'

/** One small guess Claude made without asking. */
export type Assumption = {
  /** 1-based, in the order logged this session; the number the list and the fix prompt use. */
  id: number
  /** What Claude assumed, one line. */
  text: string
  /** The file or area it applies to; null when Claude did not say. */
  where: string | null
  verdict: AssumptionVerdict
  /** When it was logged, epoch milliseconds. */
  at: number
  /** When the fix prompt for a wrong one was sent; null before. */
  fixSentAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    assumptions: {
      items: Assumption[]
      /** Folded to the one-line strip, the default (the chevron, /assumptions-collapse); mirrored to $.store. */
      isCollapsed: boolean
    }
  }
}
