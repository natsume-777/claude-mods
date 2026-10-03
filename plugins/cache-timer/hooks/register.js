// Shows how long the prompt cache has left, next to the model name in the footer.
//
// Each model request of the main conversation that reads or writes the prompt cache restarts
// its lifetime. The time of the last such request is kept in $.state, so a hot reload of this
// module keeps counting down from it; the footer reads it while drawing and is drawn again when
// it changes. A one-second ticker redraws the countdown while it runs and stops once it ends.

// The last request that touched the cache: milliseconds since the epoch; unset before the first
const LAST_REQUEST = { plugin: 'cache-timer', key: 'lastRequest' }

// The `ttl` option's values. The API's usage (turn.step's) gives the four token counts only,
// not which lifetime a cache write used, so the option decides.
const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
const DEFAULT_TTL = '1h'

const TICK_MS = 1000
// Under this many seconds left, the countdown turns to the warning color
const WARNING_SECONDS = 5 * 60

// The lifetime the `ttl` option chose; set as the module registers
let ttlMs = TTL_MS[DEFAULT_TTL]
// The countdown's redraws; one at a time, cancelled once it reaches zero
let ticker = null

export function register(on, options) {
  ttlMs = TTL_MS[options?.ttl] ?? TTL_MS[DEFAULT_TTL]

  // Fires on the session's start, and again for this module after a hot reload (which drops
  // the timers): carries on a countdown the state still holds
  on('session.start', async ($, e, next) => {
    const { value: lastRequest } = await $.state.get(LAST_REQUEST)
    if (typeof lastRequest === 'number' && (await $.clock.now()) < lastRequest + ttlMs) {
      startTicker($, lastRequest + ttlMs)
    } else {
      ticker?.cancel()
      ticker = null
    }
    return next(e)
  })

  // One model request; a subagent's (agentId set) runs in its own loop and is left out
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId == null && touchesCache(result?.usage)) {
      const now = await $.clock.now()
      // Draws the footer again for every instance that read it
      await $.state.set(LAST_REQUEST, now)
      startTicker($, now + ttlMs)
    }
    return result
  })

  // The mode labels in the footer: on the desktop app a tree of our own shows left of the
  // model name. The countdown comes first, then what the engine (and any mod beneath) draws,
  // so the original labels stay.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { value: lastRequest } = await $.state.get(LAST_REQUEST)
    const beneath = await next(e)
    if (typeof lastRequest !== 'number') return beneath

    const { Box, Text } = $.ui.resolve(e)
    const left = Math.ceil((lastRequest + ttlMs - (await $.clock.now())) / 1000)
    // A Text takes no key; the Box around it carries one
    const timer = Box({ key: 'cache-timer', children: [Text({ ...colorOf(left), children: [labelOf(left)] })] })
    // With no modes the engine's drawing has no labels to show; leave it out so no gap trails
    const isEmpty = beneath?.type === 'engine' && e.props.modes.length === 0
    if (!beneath || isEmpty) return timer
    return Box({ flexDirection: 'row', columnGap: 2, children: [timer, beneath] })
  })
}

// Redraws the countdown every second until `expiresAt`, replacing any ticker before it
function startTicker($, expiresAt) {
  ticker?.cancel()
  const own = $.clock.every(TICK_MS, async () => {
    $.ui.invalidate('ui.render')
    if ((await $.clock.now()) >= expiresAt) {
      own.cancel()
      if (ticker === own) ticker = null
    }
  })
  ticker = own
}

// Whether a response read from or wrote to the prompt cache; one that did neither (no usage,
// a prompt too short to cache) leaves the last countdown as it was
function touchesCache(usage) {
  if (!usage) return false
  return (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) > 0
}

function labelOf(seconds) {
  if (seconds <= 0) return 'Cache 切れ'
  return 'Cache ' + clockText(seconds)
}

function colorOf(seconds) {
  if (seconds <= 0) return { color: 'error' }
  if (seconds < WARNING_SECONDS) return { color: 'warning' }
  return {}
}

// mm:ss up to an hour (60:00 included), h:mm:ss beyond
function clockText(seconds) {
  const pad = (n) => String(n).padStart(2, '0')
  const s = seconds % 60
  if (seconds <= 3600) return pad(Math.floor(seconds / 60)) + ':' + pad(s)
  const h = Math.floor(seconds / 3600)
  return h + ':' + pad(Math.floor((seconds % 3600) / 60)) + ':' + pad(s)
}
