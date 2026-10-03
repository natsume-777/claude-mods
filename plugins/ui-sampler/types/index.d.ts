// The values ui-sampler keeps in $.state for the session (not $.store: a new session starts
// from the defaults in hooks/sites.js).

/** Which PromptHint prop the [PromptHint] hook writes: the whole `hint`, or only `tail`. */
export type UiSamplerPromptHintMode = 'hint' | 'tail'

/**
 * How the [Spinner] hook draws: rewrite `word`, `message` or `suffix`, draw a tree of its own
 * listing the props it received, or write that list into `word`.
 */
export type UiSamplerSpinnerMode = 'word' | 'message' | 'suffix' | 'tree' | 'props'

/** How the [CommandOutput] hook draws: a tree of its own, or a rewrite of `text`. */
export type UiSamplerCommandOutputMode = 'tree' | 'text'

/**
 * What the pane draws: the table of contents, one category's list (a CATEGORIES id), or the
 * element samples.
 */
export type UiSamplerView = 'toc' | 'lines' | 'transcript' | 'dialogs' | 'api' | 'elements' | 'samples'

declare module 'claude-code' {
  interface PluginState {
    'ui-sampler': {
      /** On/off per toggleable site, keyed by the site's id in SITES; unset means its default. */
      toggles: StateFamily<boolean>
      /** Unset means 'toc'. */
      view: UiSamplerView
      /** The site id a category view shows the detail of, keyed by the category's id in CATEGORIES; unset means none. */
      selected: StateFamily<string>
      /** Unset means 'hint'. */
      promptHintMode: UiSamplerPromptHintMode
      /** Unset means 'word'. */
      spinnerMode: UiSamplerSpinnerMode
      /** Unset means 'tree'. */
      commandOutputMode: UiSamplerCommandOutputMode
      /**
       * What a pane or the band writes back under a sample, keyed by the sample's site id in
       * SITES with a suffix where one site has several lines (`Pane/Input:submit`,
       * `AbovePrompt:press`, `DialogPane:toast`): the last press, the typed text, the picked
       * value. Unset means nothing happened yet.
       */
      echo: StateFamily<string>
    }
  }
}
