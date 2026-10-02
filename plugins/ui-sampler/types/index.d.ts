// The values ui-sampler keeps in $.state for the session (not $.store: a new session starts
// from the defaults in hooks/sites.js).

/** Which PromptHint prop the [PromptHint] hook writes: the whole `hint`, or only `tail`. */
export type UiSamplerPromptHintMode = 'hint' | 'tail'

declare module 'claude-code' {
  interface PluginState {
    'ui-sampler': {
      /** On/off per toggleable site, keyed by the site's id in SITES; unset means its default. */
      toggles: StateFamily<boolean>
      /** Unset means 'hint'. */
      promptHintMode: UiSamplerPromptHintMode
    }
  }
}
