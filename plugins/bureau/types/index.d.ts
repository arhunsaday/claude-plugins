// Contract for bureau: the values it keeps in $.state.

/** A trade in the office: the lead (the main conversation) and the teammates its subagents are. */
export type OfficeRole = 'lead' | 'research' | 'code' | 'design' | 'writing' | 'analysis' | 'helper'

/** What a tool call looks like in the office. */
export type OfficeActKind = 'search' | 'web' | 'read' | 'write' | 'edit' | 'bash' | 'plan' | 'skill' | 'mcp' | 'ask' | 'other'

export type OfficeAct = {
  kind: OfficeActKind
  /** The bubble: what the agent does, in a few words. */
  label: string
  tool: string
}

/** A subagent's life in the office: walks in, works, cheers (or fails), walks out. */
export type OfficeAgentState = 'working' | 'done' | 'error'

export type OfficeAgent = {
  /** The subagent's id, as its tool calls carry it. */
  id: string
  name: string
  role: OfficeRole
  /** The agent type it was spawned as (Explore, general-purpose, a plugin's agent). */
  type: string
  /** The Agent call's short description. */
  task: string
  /** Its desk, 0 to 5; -1 waits in the hallway. */
  desk: number
  state: OfficeAgentState
  act: OfficeAct | null
  /** When it was spawned, epoch milliseconds: it walks in from the door from then. */
  startedAt: number
  /** When it finished; null while working. It walks out a little after. */
  endedAt: number | null
  tools: number
}

/** The main conversation, at the lead's desk. */
export type OfficeLead = {
  state: 'idle' | 'working' | 'waiting'
  act: OfficeAct | null
}

export type OfficeStats = {
  agents: number
  searches: number
  pages: number
  reads: number
  writes: number
  commands: number
}

declare module 'claude-code' {
  interface PluginState {
    bureau: {
      agents: OfficeAgent[]
      lead: OfficeLead
      stats: OfficeStats
      /** The animation clock: bumped while something moves, so the pane redraws. */
      frame: number
    }
  }
}
