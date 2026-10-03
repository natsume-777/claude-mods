// The values cache-timer keeps in $.state for the session.

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      /**
       * When the main conversation's last model request that read or wrote the prompt cache
       * completed, in milliseconds since the epoch. Unset before the first such request.
       */
      lastRequest: number
      /**
       * The time of the countdown's last one-second tick, in milliseconds since the epoch.
       * Written only to draw the footer again; unset before the first tick.
       */
      tick: number
    }
  }
}
