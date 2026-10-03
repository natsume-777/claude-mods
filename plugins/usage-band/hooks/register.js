// Shows context, 5-hour limit and weekly limit usage in the band above the prompt.
// Each session shows only what it measured or read itself; nothing is shared through $.store.

// The latest figures from $.session.usage() or session.measure
let context = null
let rateLimits = []
// When the shown rate-limit figures last changed ($.clock.now() ms), and which source brought
// them: 'measure' (session.measure), 'poll' ($.session.usage() on the minute tick or an
// attach) or 'start' (the read at session start). Kept for comparing sessions side by side.
let rateLimitsAt = null
let rateLimitsSource = null
// Refreshes the countdowns; kept so a later session.start or session.end can stop it
let ticker = null

// session.end reasons after which the session is gone; /clear, /resume and logout keep it running
const FINAL_REASONS = ['prompt_input_exit', 'other']
const TICK_MS = 60_000

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
    await readUsage($, 'start')
    // Counts the resets down and polls the figures, so an idle session catches up too
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
    await readUsage($, 'start')
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Fires after each turn, and when a rate-limit window moves a whole point
  on('session.measure', async ($, e, next) => {
    context = e.context
    if (e.changed.includes('rateLimits')) setRateLimits(e.rateLimits, 'measure', await $.clock.now())
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const elements = $.ui.resolve(e)
    const now = await $.clock.now()
    const meters = [{ label: 'ctx', used: context?.percent, resetsAt: null }]
    for (const limit of rateLimits) {
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
    const stamp = rateLimits.length > 0 && rateLimitsAt != null ? clockText(rateLimitsAt) : null
    const gauge = e.surface === 'desktop' ? 'svg' : barsFit(meters, stamp, e.props.bodyColumns ?? 0) ? 'text' : 'none'

    const children = meters.map((m) => meter(elements, gauge, m))
    // When the rate-limit figures last changed, so two sessions can be compared
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

async function readUsage($, source) {
  const usage = await $.session.usage()
  context = usage.context
  setRateLimits(usage.rateLimits, source, await $.clock.now())
}

// Polls the figures and redraws; a failed read keeps the last figures
async function refresh($) {
  try {
    await readUsage($, 'poll')
  } catch {}
  $.ui.invalidate('ui.render')
}

// Takes new rate-limit figures; the time moves only when they differ from the shown ones, so
// it says how old the figures are, not when they were last asked for
function setRateLimits(limits, source, now) {
  const isFirst = rateLimitsAt == null && limits.length > 0
  if (!isFirst && JSON.stringify(limits) === JSON.stringify(rateLimits)) return
  rateLimits = limits
  rateLimitsAt = now
  rateLimitsSource = source
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
