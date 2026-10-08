// Contract for where-am-i: the values it keeps in $.state.

/** The recap a small model writes after each turn; every field one short line. */
export type WhereRecap = {
  goal: string
  now: string
  /** What Claude waits on the person for; "" when nothing. */
  waiting: string
  next: string
}

declare module 'claude-code' {
  interface PluginState {
    'where-am-i': {
      recap: WhereRecap | null
      /** What Claude is doing this moment ("editing hooks/view.tsx"); "" between turns. */
      live: string
      /** The person's latest message, first line: the goal until the first recap is written. */
      prompt: string
      /** When the current goal was first set, epoch ms; null before any. */
      since: number | null
      turns: number
      isCollapsed: boolean
      /** The clock, written each minute so the elapsed time redraws. */
      tick: number
    }
  }
}
