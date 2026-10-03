// The value cache-timer keeps in $.state for the session.

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      /**
       * When the main conversation's last model request that read or wrote the prompt cache
       * completed, in milliseconds since the epoch. Unset before the first such request.
       */
      lastRequest: number
    }
  }
}
