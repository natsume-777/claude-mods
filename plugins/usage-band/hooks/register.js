// Shows context, 5-hour limit and weekly limit usage in the band above the prompt.
// The context figure is this session's own. The rate-limit figures are the account's, but each
// session reads them only from its own last API response, so the newest reading any session
// made is shared through $.store, and every session shows the newer of its own and the stored.

// This session's context, from $.session.usage() or session.measure; never shared
let context = null
// This session's own rate-limit reading, { rateLimits, measuredAt }: measuredAt is
// $.clock.now() ms when the figures arrived here (the engine gives no response time)
let own = null
// The reading drawn: own, or the stored one when that is newer
let shown = null
// Refreshes the countdowns; kept so a later session.start or session.end can stop it
let ticker = null

// session.end reasons after which the session is gone; /clear, /resume and logout keep it running
const FINAL_REASONS = ['prompt_input_exit', 'other']
const TICK_MS = 60_000
// The $.store key holding the newest reading any session made
const STORE_KEY = 'rateLimits'
// Two resetsAt this close are the same window; the next window resets at least 5 hours later
const SAME_WINDOW_MS = 3_600_000

const LABELS = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }

// Usage at or above these percentages turns the meter yellow, then red
const WARNING_AT = 50
const ERROR_AT = 80

const BAR_CELLS = 10
const METER_GAP = 3
// The band's last columns, which the terminal may draw over
const BAND_RESERVED_COLUMNS = 2
const SVG_BAR = { width: 96, height: 10 }
const SVG_COLORS = { success: '#4caf50', warning: '#e0a526', error: '#e5534b', track: 'rgba(128,128,128,0.3)' }

export function register(on) {
  // Fires again on an enable or a worker respawn, which may keep this module's variables
  on('session.start', async ($, e, next) => {
    ticker?.cancel()
    await readUsage($)
    await sync($)
    // Counts the resets down, polls this session's figures and picks up the stored ones
    ticker = $.clock.every(TICK_MS, () => void refresh($))
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The desktop app (or another client) joined the session: read the figures again
  on('session.attach', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (FINAL_REASONS.includes(e.reason)) ticker?.cancel()
    return next(e)
  })

  // session.measure reports a changed context only after the next turn, so read it now
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork', 'compact'] }, async ($, e, next) => {
    await readUsage($)
    await sync($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Fires after each turn, and when a rate-limit window moves a whole point
  on('session.measure', async ($, e, next) => {
    context = e.context
    takeRateLimits(e.rateLimits, await $.clock.now())
    await sync($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const elements = $.ui.resolve(e)
    const now = await $.clock.now()
    const meters = [{ label: 'ctx', used: context?.percent, resetsAt: null }]
    for (const limit of shown?.rateLimits ?? []) {
      const resetsAt = limit.resetsAt == null ? null : Date.parse(limit.resetsAt)
      // A window that reset since the last measurement starts again from zero
      const reset = resetsAt != null && resetsAt <= now
      meters.push({
        label: LABELS[limit.kind] ?? limit.kind,
        used: reset ? 0 : limit.percentUsed,
        resetsAt: reset ? null : resetsAt,
      })
    }
    for (const m of meters) m.value = valueText(m, now)
    const stamp = shown && shown.rateLimits.length > 0 ? clockText(shown.measuredAt) : null
    const gauge = e.surface === 'desktop' ? 'svg' : barsFit(meters, stamp, e.props.bodyColumns ?? 0) ? 'text' : 'none'

    const children = meters.map((m) => meter(elements, gauge, m))
    // When the shown rate-limit figures were measured, by whichever session
    if (stamp) {
      const time = elements.Text({ dimColor: true, children: [stamp] })
      children.push(elements.Box({ key: 'rate-time', flexDirection: 'row', alignItems: 'center', children: [time] }))
    }
    const line = elements.Box({ flexDirection: 'row', columnGap: METER_GAP, children })
    // Keep what later mods draw in the band
    const rest = await next(e)
    if (!rest) return line
    return elements.Box({ flexDirection: 'column', children: [line, rest] })
  })
}

async function readUsage($) {
  const usage = await $.session.usage()
  context = usage.context
  takeRateLimits(usage.rateLimits, await $.clock.now())
}

// Polls this session's figures, syncs with the store and redraws; a failed read keeps the last
// figures
async function refresh($) {
  try {
    await readUsage($)
  } catch {}
  await sync($)
  $.ui.invalidate('ui.render')
}

// Takes this session's rate-limit figures as a new reading only when they differ from its last
// one, so measuredAt says how old the figures are, not when they were last asked for
function takeRateLimits(limits, now) {
  if (!Array.isArray(limits) || limits.length === 0) return
  if (own && JSON.stringify(limits) === JSON.stringify(own.rateLimits)) return
  own = { rateLimits: limits, measuredAt: now }
}

// Publishes this session's reading when it is newer than the stored one, and shows the newer of
// the two. Read, compare, write: two sessions syncing at once may both write, and the later
// write wins even if it is the older reading. That loses at most a moment's difference, and the
// session holding the newer reading writes it again on its next sync (within a minute).
async function sync($) {
  let stored = null
  try {
    stored = asReading(await $.store.get(STORE_KEY))
  } catch {}
  if (own && newer(own, stored) === own) {
    try {
      await $.store.set(STORE_KEY, own)
    } catch {}
  }
  shown = newer(own, stored)
}

// A stored value as a reading, or null when it is not one (unset, or written by something else)
function asReading(value) {
  if (!value || !Array.isArray(value.rateLimits) || typeof value.measuredAt !== 'number') return null
  return value
}

// The newer of two readings; b when they tie. The figures decide first: a percentage never falls
// within a window, so a reading behind the other is older whatever its time says (a stale reading
// stamped late, such as the one a re-fired session.start takes in an idle session). The time
// decides otherwise.
function newer(a, b) {
  if (!a) return b
  if (!b) return a
  const aBehind = isBehind(a.rateLimits, b.rateLimits)
  const bBehind = isBehind(b.rateLimits, a.rateLimits)
  if (aBehind !== bBehind) return aBehind ? b : a
  return a.measuredAt > b.measuredAt ? a : b
}

// Whether some window in a is an earlier window than in b, or the same window used less
function isBehind(a, b) {
  return a.some((x) => {
    const y = b.find((l) => l.kind === x.kind)
    if (!y || x.resetsAt == null || y.resetsAt == null) return false
    const gap = Date.parse(y.resetsAt) - Date.parse(x.resetsAt)
    if (gap > SAME_WINDOW_MS) return true
    return Math.abs(gap) <= SAME_WINDOW_MS && x.percentUsed < y.percentUsed
  })
}

function statusOf(used) {
  if (used >= ERROR_AT) return 'error'
  if (used >= WARNING_AT) return 'warning'
  return 'success'
}

function valueText({ used, resetsAt }, now) {
  let value = typeof used === 'number' ? Math.round(used) + '%' : '—'
  if (resetsAt != null) value += ' ' + untilReset(resetsAt - now)
  return value
}

// Whether every meter fits on one line with its text bar; every character drawn is one cell wide
function barsFit(meters, stamp, columns) {
  let width = meters.reduce((sum, m) => sum + [...m.label].length + 1 + BAR_CELLS + 1 + [...m.value].length, 0)
  width += METER_GAP * (meters.length - 1)
  if (stamp) width += METER_GAP + stamp.length
  return width <= columns - BAND_RESERVED_COLUMNS
}

// Local time as HH:MM
function clockText(ms) {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function meter({ Box, Text, Svg }, gauge, { label, used, value }) {
  const known = typeof used === 'number'
  const status = known ? statusOf(used) : null
  const children = [Text({ children: [label] })]
  if (gauge === 'svg') {
    children.push(
      Svg({
        source: svgBar(known ? used : 0, status),
        alt: label + ' ' + value,
        width: SVG_BAR.width,
        height: SVG_BAR.height,
      }),
    )
  } else if (gauge === 'text') {
    children.push(textBar(Text, known ? used : 0, status))
  }
  children.push(Text({ ...(known ? { color: status } : { dimColor: true }), children: [value] }))
  return Box({ key: 'meter-' + label, flexDirection: 'row', columnGap: 1, alignItems: 'center', children })
}

// Used cells in the status color, the rest dim, nested in one Text so they stay on one line
function textBar(Text, used, status) {
  const filled = Math.round((clamp(used) / 100) * BAR_CELLS)
  return Text({
    children: [
      Text({ ...(status ? { color: status } : { dimColor: true }), children: ['█'.repeat(filled)] }),
      Text({ dimColor: true, children: ['░'.repeat(BAR_CELLS - filled)] }),
    ],
  })
}

function svgBar(used, status) {
  const { width, height } = SVG_BAR
  const fill = Math.round((clamp(used) / 100) * width)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<clipPath id="c"><rect width="${width}" height="${height}" rx="${height / 2}"/></clipPath>`,
    `<g clip-path="url(#c)">`,
    `<rect width="${width}" height="${height}" fill="${SVG_COLORS.track}"/>`,
    fill > 0 ? `<rect width="${fill}" height="${height}" fill="${SVG_COLORS[status ?? 'success']}"/>` : '',
    '</g></svg>',
  ].join('')
}

function clamp(percent) {
  return Math.min(Math.max(percent, 0), 100)
}

function untilReset(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return days + 'd' + hours + 'h'
  if (hours > 0) return hours + 'h' + (minutes % 60) + 'm'
  return (minutes % 60) + 'm'
}
