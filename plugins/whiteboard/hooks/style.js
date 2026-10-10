// A card's style: a colour by hue name, or the decorative rainbow (pure: no $ here).
//
// The names are hues only; no colour carries a meaning here. Claude may name one of STYLES and
// nothing else (no raw colour codes, no theme keys). The seven single colours draw through a
// palette: a theme key each by default, so they follow the person's light or dark theme, and the
// setting `colors` may point any of them at another theme key or a hex code, so that the person
// can pick colours they tell apart. The rainbow (see HIDDEN) is fixed and not touched by the setting.

/** The single-colour styles, in the order the tools list them. */
export const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']

// The rainbow is an easter egg: accepted and drawn, but never named to Claude or the person: not
// in the tools' schemas and descriptions, the error that lists the names, the README, the skill
// (SKILL.md), plugin.json or types/index.d.ts
const HIDDEN = ['rainbow']

/** Every style a card may carry. */
export const STYLES = [...COLOR_NAMES, ...HIDDEN]

/** The names the tools and the error list: the single colours and `none` (which removes the style). */
export const STYLE_INPUTS = [...COLOR_NAMES, 'none']

/** The default theme key of each single colour. */
export const DEFAULT_PALETTE = {
  red: 'error',
  orange: 'claude',
  yellow: 'warning',
  green: 'success',
  blue: 'suggestion',
  purple: 'merged',
  gray: 'inactive',
}

/** The rainbow's seven fixed hues: red, orange, yellow, green, blue, indigo, violet. */
export const RAINBOW = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#3949AB', '#8E24AA']

// The theme keys the engine names (ThemeKey); the setting may use any of them, in any case
const THEME_KEYS = [
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude',
  'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide', 'diffAdded', 'diffRemoved', 'diffAddedDimmed',
  'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord',
]
const THEME_BY_LOWER = new Map(THEME_KEYS.map((k) => [k.toLowerCase(), k]))
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** A stored style that is one of STYLES; anything else (none, absent, broken) is no style. */
export const isStyle = (value) => typeof value === 'string' && STYLES.includes(value)

/** The style a card (or a version of one) carries: one of STYLES, else null. */
export const styleOf = (c) => (isStyle(c?.style) ? c.style : null)

/**
 * A tool's `style` input: { keep: true } when absent, { style: null } for none, { style } for one
 * of STYLES, or { error } that lists the names.
 */
export function styleInput(value) {
  if (value === undefined) return { keep: true }
  if (value === 'none') return { style: null }
  if (isStyle(value)) return { style: value }
  return { error: `style は ${STYLE_INPUTS.join(' / ')} のどれかで指定してください（色コードやほかの語は使えません。none で色を外します）` }
}

/** The colour a value of the setting names: a theme key (its own spelling) or a hex code; null for anything else. */
function colorValue(text) {
  const v = text.trim()
  if (HEX.test(v)) return v
  return THEME_BY_LOWER.get(v.toLowerCase()) ?? null
}

/**
 * The palette from the setting `colors` ("red=#D55E00, green=#009E73, blue=suggestion"): the
 * defaults with each well-formed entry laid over. An entry with an unknown name or a value that is
 * neither a theme key nor #rgb / #rrggbb is let go by itself.
 */
export function paletteOf(options = {}) {
  const palette = { ...DEFAULT_PALETTE }
  const text = options?.colors
  if (typeof text !== 'string') return palette
  for (const entry of text.split(/[,\n;]/)) {
    const at = entry.indexOf('=')
    if (at < 0) continue
    const name = entry.slice(0, at).trim().toLowerCase()
    if (!COLOR_NAMES.includes(name)) continue
    const color = colorValue(entry.slice(at + 1))
    if (color !== null) palette[name] = color
  }
  return palette
}

/** The colour a single-colour style draws with; null for no style and for the rainbow. */
export const colorOf = (style, palette = DEFAULT_PALETTE) => (COLOR_NAMES.includes(style) ? palette[style] ?? DEFAULT_PALETTE[style] : null)

// The setting `styleMarks`: a small shape before a single-colour card's title, one per name, for
// people who do not tell the colours apart. Tied to the name, not to the colour `colors` gives it,
// so a shape keeps its meaning whatever the palette. Geometric shapes and dingbats with no emoji
// presentation (a plain text glyph in any font that has them; no variation selector needed).
export const SHAPES = {
  red: '●', // U+25CF black circle
  orange: '▲', // U+25B2 black up-pointing triangle
  yellow: '◆', // U+25C6 black diamond
  green: '■', // U+25A0 black square
  blue: '★', // U+2605 black star
  purple: '✚', // U+271A heavy greek cross
  gray: '○', // U+25CB white circle
}

/** The setting `styleMarks`: off unless true. */
export const shapesOn = (options) => options?.styleMarks === true

/** The shape of a single-colour style; null for no style and for the rainbow. */
export const shapeOf = (style) => (COLOR_NAMES.includes(style) ? SHAPES[style] : null)
