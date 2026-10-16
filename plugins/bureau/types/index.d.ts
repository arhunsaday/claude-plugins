// Contract for bureau: the values it keeps in $.state. The office itself (the engine's world, its robots and
// their walks) lives in the hooks module's memory; the state only says when to draw it again.

/** The animation clock: bumped when the office moved, so the pane redraws. */
export type BureauFrame = number

declare module 'claude-code' {
  interface PluginState {
    bureau: {
      frame: BureauFrame
    }
  }
}
