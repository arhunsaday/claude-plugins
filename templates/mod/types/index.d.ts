// Contract for example-mod: the values it keeps in $.state.

/** Whether the band above the prompt is shown. */
export type ExampleModIsOpen = boolean

declare module 'claude-code' {
  interface PluginState {
    'example-mod': {
      isOpen: ExampleModIsOpen
    }
  }
}
