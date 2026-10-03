// The gauge line, `トークン ■■■■■■□□□□ OK`: a label, a bar with no number, and the stage's
// word. Drawn the way usage-band draws its meters, so the two look alike in the band: an SVG
// bar on the desktop app, a text bar elsewhere.
//
// On a narrow line the parts give way in a fixed order (fitMeter): the band's short phrase
// first, then the bar shortens, then the bar goes, then the label; the stage's word and the
// buttons always stay. Every part but the phrase keeps its width (flexShrink 0), so none of
// them wraps inside the row.
//
// Pure: no $ here, so the hook files keep every $ call themselves.

import { STAGE_LABEL } from './ledger.js'

/** The line's label. */
export const LABEL = 'トークン'

// The text bar's cells, at full length and shortened
const BAR_CELLS = { full: 10, short: 5 }
// The SVG bar's size in pixels, at full length and shortened
const SVG_BAR = { full: 96, short: 48, height: 10 }
// Pixels taken as one cell of the surface's monospace metric, to size the SVG bar in cells
// (an estimate: the desktop app does not report its font's advance)
const PX_PER_CELL = 8
// The line's last columns, which the terminal may draw over
const RESERVED_COLUMNS = 2
// The fewest cells the phrase keeps, its ellipsis included; below this it is left out
const MIN_PHRASE_CELLS = 8
const SVG_COLORS = { success: '#4caf50', warning: '#e0a526', error: '#e5534b', track: 'rgba(128,128,128,0.3)' }

/** The theme color of the bar's fill and of the stage's word, by stage ('ok' leaves the word as it is). */
const STAGE_COLOR = { ok: 'success', soon: 'warning', switch: 'error' }

/** Character cells a text takes: two for a wide (CJK, full-width) character, one otherwise. */
export function cells(text) {
  let n = 0
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    n += c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)) ? 2 : 1
  }
  return n
}

/** The cells a Button takes: its label in brackets on a terminal, inside a frame elsewhere (an estimate). */
export const buttonCells = (surface, label) => cells(label) + (surface === 'terminal' ? 2 : 4)

// The cells the bar takes at a length ('full', 'short')
const barCells = (surface, length) => (surface === 'desktop' ? Math.ceil(SVG_BAR[length] / PX_PER_CELL) : BAR_CELLS[length])

// How the line may give way, widest first
const STEPS = [
  { hasLabel: true, bar: 'full', hasPhrase: true },
  { hasLabel: true, bar: 'full', hasPhrase: false },
  { hasLabel: true, bar: 'short', hasPhrase: false },
  { hasLabel: true, bar: null, hasPhrase: false },
  { hasLabel: false, bar: null, hasPhrase: false },
]

/**
 * Which parts of the line fit in `columns`: { hasLabel, bar ('full' | 'short' | null),
 * hasPhrase }. `phrase` is the band's short phrase (null for none), `buttons` the labels of the
 * Buttons after it. Parts sit a column apart. With no width known (0, absent) everything is
 * drawn; when nothing fits, the narrowest step (the stage's word and the buttons).
 */
export function fitMeter({ surface, stage, columns, phrase = null, buttons = [] }) {
  const steps = STEPS.map((s) => ({ ...s, hasPhrase: s.hasPhrase && phrase != null }))
  if (!(typeof columns === 'number' && columns > 0)) return steps[0]
  const room = columns - RESERVED_COLUMNS
  for (const step of steps) {
    const widths = [cells(STAGE_LABEL[stage] ?? ''), ...buttons.map((b) => buttonCells(surface, b))]
    if (step.hasLabel) widths.push(cells(LABEL))
    if (step.bar) widths.push(barCells(surface, step.bar))
    if (step.hasPhrase) widths.push(1, Math.min(MIN_PHRASE_CELLS, cells(phrase)))
    if (widths.reduce((a, b) => a + b, 0) + widths.length - 1 <= room) return step
  }
  return steps[steps.length - 1]
}

/**
 * The line's parts, to sit in a row: the label, the bar and the stage's word as `fit`
 * (fitMeter's result) says, each in a keyed Box that does not shrink (a Text carries no key).
 * `g` is ledger.js gaugeOf's result with a known percent.
 */
export function meterParts(ui, surface, fit, g) {
  const color = STAGE_COLOR[g.stage]
  const word = STAGE_LABEL[g.stage]
  const part = (key, child) => ui.Box({ key, flexDirection: 'row', flexShrink: 0, children: [child] })
  const parts = []
  if (fit.hasLabel) parts.push(part('meter-label', ui.Text({ wrap: 'truncate-end', children: [LABEL] })))
  if (fit.bar && surface === 'desktop') {
    const width = SVG_BAR[fit.bar]
    parts.push(part('meter-bar', ui.Svg({ source: svgBar(g.percent, color, width), alt: LABEL + ' ' + word, width, height: SVG_BAR.height })))
  } else if (fit.bar) {
    parts.push(part('meter-bar', textBar(ui.Text, g.percent, color, BAR_CELLS[fit.bar])))
  }
  parts.push(part('meter-stage', ui.Text({ wrap: 'truncate-end', ...(g.stage === 'ok' ? {} : { color }), children: [word] })))
  return parts
}

/** How many of a text bar's `total` cells are filled. */
export const filledCells = (percent, total = BAR_CELLS.full) => Math.round((clamp(percent) / 100) * total)

// Filled cells in the stage's color, the rest dim, nested in one Text so they stay on one line
function textBar(Text, percent, color, total) {
  const filled = filledCells(percent, total)
  return Text({
    wrap: 'truncate-end',
    children: [Text({ color, children: ['█'.repeat(filled)] }), Text({ dimColor: true, children: ['░'.repeat(total - filled)] })],
  })
}

/** An SVG bar's fill width in pixels, out of `width`. */
export const filledPixels = (percent, width = SVG_BAR.full) => Math.round((clamp(percent) / 100) * width)

function svgBar(percent, color, width) {
  const { height } = SVG_BAR
  const fill = filledPixels(percent, width)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<clipPath id="c"><rect width="${width}" height="${height}" rx="${height / 2}"/></clipPath>`,
    `<g clip-path="url(#c)">`,
    `<rect width="${width}" height="${height}" fill="${SVG_COLORS.track}"/>`,
    fill > 0 ? `<rect width="${fill}" height="${height}" fill="${SVG_COLORS[color] ?? SVG_COLORS.success}"/>` : '',
    '</g></svg>',
  ].join('')
}

function clamp(percent) {
  return Math.min(Math.max(percent, 0), 100)
}
