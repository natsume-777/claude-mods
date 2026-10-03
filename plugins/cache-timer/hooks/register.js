// Shows how long the prompt cache has left, next to the model name in the footer.
//
// Each model request of the main conversation that reads or writes the prompt cache restarts
// its lifetime. The time of the last such request is kept in $.state, so a hot reload of this
// module keeps counting down from it; the footer reads it while drawing and is drawn again when
// it changes. While the countdown runs, a ticker writes the time to $.state only when the label
// changes (once a minute, and once at expiry); only the footer reads that value, so only the
// footer is drawn again (a $.ui.invalidate would redraw every plugin's ui.render). Even so, on
// the desktop app any redraw of a mod drawing rebuilds every mod drawing, other mods' open panes
// included, so the label counts minutes to keep the redraws few.

// The last request that touched the cache: milliseconds since the epoch; unset before the first
const LAST_REQUEST = { plugin: 'cache-timer', key: 'lastRequest' }
// The ticker's last tick: milliseconds since the epoch. Read by the footer only to be drawn again
const TICK = { plugin: 'cache-timer', key: 'tick' }

// The `ttl` option's values. The API's usage (turn.step's) gives the four token counts only,
// not which lifetime a cache write used, so the option decides.
const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
const DEFAULT_TTL = '1h'

// Under this many seconds left, the countdown turns to the warning color
const WARNING_SECONDS = 5 * 60

// The lifetime the `ttl` option chose; set as the module registers
let ttlMs = TTL_MS[DEFAULT_TTL]
// The countdown's next redraw (a $.clock.after timer); one at a time, none once it reaches zero
let ticker = null

export function register(on, options) {
  ttlMs = TTL_MS[options?.ttl] ?? TTL_MS[DEFAULT_TTL]

  // Fires on the session's start, and again for this module after a hot reload (which drops
  // the timers): carries on a countdown the state still holds
  on('session.start', async ($, e, next) => {
    const { value: lastRequest } = await $.state.get(LAST_REQUEST)
    const now = await $.clock.now()
    if (typeof lastRequest === 'number' && now < lastRequest + ttlMs) {
      startTicker($, lastRequest + ttlMs, now)
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
      startTicker($, now + ttlMs, now)
    }
    return result
  })

  // The mode labels in the footer: on the desktop app a tree of our own shows left of the
  // model name. The countdown comes first, then what the engine (and any mod beneath) draws,
  // so the original labels stay.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { value: lastRequest } = await $.state.get(LAST_REQUEST)
    // Subscribes this drawing to the ticker; the time itself comes from the clock below, which
    // is right before the first tick as well
    await $.state.get(TICK)
    const beneath = await next(e)
    if (typeof lastRequest !== 'number') return beneath

    const { Box, Text } = $.ui.resolve(e)
    const left = secondsLeft(lastRequest + ttlMs - (await $.clock.now()))
    // A Text takes no key; the Box around it carries one
    const timer = Box({ key: 'cache-timer', children: [Text({ ...colorOf(left), children: [labelOf(left)] })] })
    // With no modes the engine's drawing has no labels to show; leave it out so no gap trails
    const isEmpty = beneath?.type === 'engine' && e.props.modes.length === 0
    if (!beneath || isEmpty) return timer
    return Box({ flexDirection: 'row', columnGap: 2, children: [timer, beneath] })
  })
}

// Redraws the countdown each time its label changes, from `now` until `expiresAt`, replacing
// any ticker before it. Each tick writes the time to TICK, which draws again the footers that
// read it, and nothing else
function startTicker($, expiresAt, now) {
  ticker?.cancel()
  ticker = null
  const schedule = (remainingMs) => {
    if (remainingMs <= 0) return
    const own = $.clock.after(remainingMs - nextChangeAt(remainingMs), async () => {
      if (ticker !== own) return
      ticker = null
      const tickedAt = await $.clock.now()
      await $.state.set(TICK, tickedAt)
      // A new request or a reload replaced this ticker while the state was being written
      if (ticker !== null) return
      schedule(expiresAt - tickedAt)
    })
    ticker = own
  }
  schedule(expiresAt - now)
}

// The remaining milliseconds at which the label next changes, below `remainingMs`: the label
// shows whole minutes of the whole seconds left (as the minutes of mm:ss), so it changes when
// the seconds left reach 60k - 1 for some k >= 1 (59:59, 58:59, ..., 00:59), and at zero
function nextChangeAt(remainingMs) {
  const k = Math.ceil((remainingMs + 1000) / 60_000) - 1
  return k >= 1 ? k * 60_000 - 1000 : 0
}

// Whether a response read from or wrote to the prompt cache; one that did neither (no usage,
// a prompt too short to cache) leaves the last countdown as it was
function touchesCache(usage) {
  if (!usage) return false
  return (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) > 0
}

// Whole seconds left, rounded up so the label reads "切れ" only once the time is over
function secondsLeft(remainingMs) {
  return Math.ceil(remainingMs / 1000)
}

// Whole minutes up to an hour (60m included) and beyond; "<1m" under a minute, never "0m"
function labelOf(seconds) {
  if (seconds <= 0) return 'Cache 切れ'
  if (seconds < 60) return 'Cache <1m'
  return 'Cache ' + Math.floor(seconds / 60) + 'm'
}

function colorOf(seconds) {
  if (seconds <= 0) return { color: 'error' }
  if (seconds < WARNING_SECONDS) return { color: 'warning' }
  return {}
}
