// Shows context, 5-hour limit and weekly limit usage in the band above the prompt.
// On a narrow band the parts give way in a fixed order (fitBand): the clock first, then the
// reset countdowns, then the bars shorten, then the bars go; the labels and percentages stay.
// Every meter keeps its width (flexShrink 0), so none of them overlaps another or wraps.
// The context figure is this session's own. The rate-limit figures are the account's, but each
// session reads them only from its own last API response, so the newest reading any session
// made is shared through $.store, and every session shows the newer of its own and the stored.
// With the `log` option on, each reading a session publishes to the store is also appended to
// a daily JSON Lines file under `logDir`, so the readings can be aggregated later.

// This session's context, from $.session.usage() or session.measure; never shared
let context = null
// This session's own rate-limit reading, { rateLimits, measuredAt }: measuredAt is
// $.clock.now() ms when the figures arrived here (the engine gives no response time)
let own = null
// The reading drawn: own, or the stored one when that is newer
let shown = null
// Refreshes the countdowns; kept so a later session.start or session.end can stop it
let ticker = null
// register()'s options, defaults filled in
let config = null
// The last reading appended to the log, so a reading stored again (after another session's older
// write landed last) is not logged twice
let logged = null
// Log appends run one after another, so two in one session never read the same old file
let logQueue = Promise.resolve()
// Whether this session has shown its one toast about the log
let logWarned = false

// session.end reasons after which the session is gone; /clear, /resume and logout keep it running
const FINAL_REASONS = ['prompt_input_exit', 'other']
const TICK_MS = 60_000
// The $.store key holding the newest reading any session made
const STORE_KEY = 'rateLimits'
// Two resetsAt this close are the same window; the next window resets at least 5 hours later
const SAME_WINDOW_MS = 3_600_000

const LABELS = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }

const DEFAULTS = { log: false, logDir: '~/.claude/usage-band/' }

// Usage at or above these percentages turns the meter yellow, then red
const WARNING_AT = 50
const ERROR_AT = 80

// The text bar's cells, at full length and shortened
const BAR_CELLS = { full: 10, short: 5 }
const METER_GAP = 3
// The band's last columns, which the terminal may draw over
const BAND_RESERVED_COLUMNS = 2
// The SVG bar's size in pixels, at full length and shortened
const SVG_BAR = { full: 96, short: 48, height: 10 }
// Pixels taken as one cell, to size the SVG bar in cells (an estimate: the desktop app does not
// report its font's advance)
const PX_PER_CELL = 8
const SVG_COLORS = { success: '#4caf50', warning: '#e0a526', error: '#e5534b', track: 'rgba(128,128,128,0.3)' }

// How the band may give way, widest first
const STEPS = [
  { bar: 'full', hasResets: true, hasClock: true },
  { bar: 'full', hasResets: true, hasClock: false },
  { bar: 'full', hasResets: false, hasClock: false },
  { bar: 'short', hasResets: false, hasClock: false },
  { bar: null, hasResets: false, hasClock: false },
]

export function register(on, options) {
  config = configOf(options)
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
    for (const m of meters) {
      m.percent = percentText(m.used)
      m.reset = m.resetsAt == null ? null : untilReset(m.resetsAt - now)
    }
    const stamp = shown && shown.rateLimits.length > 0 ? clockText(shown.measuredAt) : null
    const fit = fitBand(meters, stamp, e.surface, widthOf(e))

    const children = meters.map((m) => meter(elements, e.surface, fit, m))
    // When the shown rate-limit figures were measured, by whichever session
    if (stamp && fit.hasClock) {
      const time = elements.Text({ dimColor: true, wrap: 'truncate-end', children: [stamp] })
      children.push(elements.Box({ key: 'rate-time', flexDirection: 'row', flexShrink: 0, alignItems: 'center', children: [time] }))
    }
    const line = elements.Box({ flexDirection: 'row', flexWrap: 'nowrap', columnGap: METER_GAP, children })
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
    if (config.log && own !== logged) {
      const reading = own
      logged = reading
      logQueue = logQueue.then(() => appendLog($, reading))
      await logQueue
    }
  }
  shown = newer(own, stored)
}

// register()'s options; a value of the wrong type keeps the default
function configOf(options) {
  const logDir = options?.logDir
  return {
    log: typeof options?.log === 'boolean' ? options.log : DEFAULTS.log,
    logDir: typeof logDir === 'string' && logDir.trim() !== '' ? logDir.trim() : DEFAULTS.logDir,
  }
}

// Appends one line for `reading` to the day's file. $.fs has no append, so the day's file is
// read whole and written back. Never throws: a failure shows one toast per session at most.
// Two sessions appending at the same moment could lose a line; only the session holding a newer
// reading writes, so that takes two new readings within one read and write.
async function appendLog($, reading) {
  try {
    const now = await $.clock.now()
    const dir = await logDirPath($)
    if (dir == null) {
      warnLog($, 'usage-band: ホームフォルダが分からないため、使用率の記録を書けません。/config usage-band.logDir=<フォルダ> で記録の置き場を指定してください')
      return
    }
    const path = dir + '/' + logFileName(now)
    let text = ''
    // A file that exists but cannot be read is left alone rather than overwritten
    if (await $.fs.exists(path)) text = await $.fs.read(path)
    if (text !== '' && !text.endsWith('\n')) text += '\n'
    await $.fs.write(path, text + logLine(reading, now) + '\n')
  } catch (error) {
    warnLog($, 'usage-band: 使用率の記録を書けませんでした（' + String(error?.message ?? error) + '）')
  }
}

function warnLog($, text) {
  if (logWarned) return
  logWarned = true
  $.ui.toast(text)
}

// logDir as an absolute path with forward slashes and no trailing slash; a leading `~` is the
// home folder (USERPROFILE on Windows, else HOME). null when `~` is used and neither is set.
async function logDirPath($) {
  let dir = config.logDir.replace(/\\/g, '/')
  if (dir === '~' || dir.startsWith('~/')) {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
    if (!home) return null
    dir = home.replace(/\\/g, '/').replace(/\/+$/, '') + dir.slice(1)
  }
  return dir.length > 1 ? dir.replace(/\/+$/, '') : dir
}

// usage-YYYYMMDD.jsonl, by the local date
function logFileName(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return 'usage-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.jsonl'
}

// One JSON object: ts (when written) and, per window kind, the raw percentage and reset time
function logLine(reading, now) {
  const line = { ts: new Date(now).toISOString() }
  for (const limit of reading.rateLimits) {
    line[limit.kind] = { used: limit.percentUsed, resets_at: limit.resetsAt ?? null }
  }
  return JSON.stringify(line)
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

function percentText(used) {
  return typeof used === 'number' ? Math.round(used) + '%' : '—'
}

// The cells across the band: the site's own width, else what the surface measured; null when
// neither is known
function widthOf(e) {
  const n = e.props?.bodyColumns
  if (typeof n === 'number' && n > 0) return n
  const v = e.viewport?.columns
  return typeof v === 'number' && v > 0 ? v : null
}

// Character cells a text takes: two for a wide (CJK, full-width) character, one otherwise
function cells(text) {
  let n = 0
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    n += c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)) ? 2 : 1
  }
  return n
}

// The cells a bar takes at a length ('full', 'short')
function barCells(surface, length) {
  return surface === 'desktop' ? Math.ceil(SVG_BAR[length] / PX_PER_CELL) : BAR_CELLS[length]
}

// The first step of STEPS whose parts fit on one line in `columns`: everything when the width
// is unknown, the narrowest step when nothing fits
function fitBand(meters, stamp, surface, columns) {
  if (columns == null) return STEPS[0]
  const room = columns - BAND_RESERVED_COLUMNS
  for (const step of STEPS) {
    let width = METER_GAP * (meters.length - 1)
    for (const m of meters) {
      width += cells(m.label) + 1 + cells(m.percent)
      if (step.bar) width += 1 + barCells(surface, step.bar)
      if (step.hasResets && m.reset) width += 1 + cells(m.reset)
    }
    if (step.hasClock && stamp) width += METER_GAP + cells(stamp)
    if (width <= room) return step
  }
  return STEPS[STEPS.length - 1]
}

// Local time as HH:MM
function clockText(ms) {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// One meter: the label, the bar as `fit` says, and the percentage with its countdown when `fit`
// keeps it. The Box does not shrink, so its parts never wrap or slide under the next meter.
function meter({ Box, Text, Svg }, surface, fit, { label, used, percent, reset }) {
  const known = typeof used === 'number'
  const status = known ? statusOf(used) : null
  const value = fit.hasResets && reset ? percent + ' ' + reset : percent
  const children = [Text({ wrap: 'truncate-end', children: [label] })]
  if (fit.bar && surface === 'desktop') {
    const width = SVG_BAR[fit.bar]
    children.push(
      Svg({
        source: svgBar(known ? used : 0, status, width),
        alt: label + ' ' + percent + (reset ? ' ' + reset : ''),
        width,
        height: SVG_BAR.height,
      }),
    )
  } else if (fit.bar) {
    children.push(textBar(Text, known ? used : 0, status, BAR_CELLS[fit.bar]))
  }
  children.push(Text({ wrap: 'truncate-end', ...(known ? { color: status } : { dimColor: true }), children: [value] }))
  return Box({ key: 'meter-' + label, flexDirection: 'row', flexShrink: 0, columnGap: 1, alignItems: 'center', children })
}

// Used cells in the status color, the rest dim, nested in one Text so they stay on one line
function textBar(Text, used, status, total) {
  const filled = Math.round((clamp(used) / 100) * total)
  return Text({
    wrap: 'truncate-end',
    children: [
      Text({ ...(status ? { color: status } : { dimColor: true }), children: ['█'.repeat(filled)] }),
      Text({ dimColor: true, children: ['░'.repeat(total - filled)] }),
    ],
  })
}

function svgBar(used, status, width) {
  const { height } = SVG_BAR
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
