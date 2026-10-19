// The look the pane and the band share: spacing, colors, button roles, and small builders for
// the recurring blocks (a header, a section, a table row, a key/value field). Pure: each
// builder takes the element table `$.ui.resolve(e)` handed out (`ui`) and never touches $.

import { cells } from './meter.js'

/** Spacing, in character cells. */
export const SPACE = {
  page: 1, // the left and right padding of the pane
  section: 1, // blank rows between sections
  inline: 1, // columns between buttons in a row
  column: 2, // columns between the cells of a table row
  indent: 2, // the indent of a section's body, and of a row's details
}

/** Theme color names only, so the surface's theme decides the shade. */
export const COLOR = {
  warn: 'warning',
  bad: 'error',
  good: 'success',
}

/**
 * Button roles, spread into a Button's props.
 * main: the one action a place leads to, and the picked one of several choices.
 * nav: moving between views, closing.
 * minor: an unpicked choice, a row's closed [▸].
 */
export const BUTTON = {
  main: { variant: 'primary' },
  nav: { variant: 'secondary' },
  minor: { variant: 'secondary', dimColor: true },
}

/** The role of a button that is one of several choices: picked is main, the rest minor. */
export const choice = (isPicked) => (isPicked ? BUTTON.main : BUTTON.minor)

/** Dim text that wraps at the pane's edge. */
export const dim = (ui, key, text) => ui.Box({ key, children: [ui.Text({ dimColor: true, wrap: 'wrap', children: [text] })] })

/** A row of buttons (or other inline items), wrapping when narrow. */
export const inline = (ui, key, children, marginTop = 0) =>
  ui.Box({ key, marginTop, flexDirection: 'row', columnGap: SPACE.inline, rowGap: 1, alignItems: 'center', flexWrap: 'wrap', children })

/** A cell of fixed width holding one line of text, cut with … when too long. */
export const cell = (ui, width, text, props = {}, align = 'flex-start') =>
  ui.Box({
    width,
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: align,
    children: [ui.Text({ wrap: 'truncate-end', ...props, children: [String(text)] })],
  })

/** A cell of fixed width holding elements (a button). */
export const slot = (ui, width, children) => ui.Box({ width, flexShrink: 0, flexDirection: 'row', children })

/** A table row: cells on one line. */
export const tableRow = (ui, key, children) =>
  ui.Box({ key, flexDirection: 'row', columnGap: SPACE.column, alignItems: 'center', width: '100%', children })

/** A key/value line: the name dim in a fixed column, the value wrapping beside it. */
export const field = (ui, key, name, value, width = 18, props = {}) =>
  ui.Box({
    key,
    flexDirection: 'row',
    columnGap: SPACE.column,
    width: '100%',
    children: [
      ui.Box({ width, flexShrink: 0, children: [ui.Text({ dimColor: true, children: [name] })] }),
      ui.Box({ flexGrow: 1, flexShrink: 1, children: [ui.Text({ wrap: 'wrap', ...props, children: [value] })] }),
    ],
  })

// The least cells a field's value keeps beside its name; with less, a value too long for one
// line goes under its name instead of wrapping a few characters a line
const FIELD_MIN = 20

/**
 * Whether a field whose name column is `width` cells goes under its name in a body `room`
 * cells wide (null: unknown, kept beside).
 */
export const isStacked = (room, width, value) => {
  if (room == null) return false
  const beside = room - width - SPACE.column
  return beside < FIELD_MIN && cells(value) > beside
}

/**
 * A key/value field under its name, for a narrow pane: the name dim on its own line, the value
 * under it at the full width, indented; `extra` (such as a dim note) under the value.
 */
export const stackedField = (ui, key, name, value, props = {}, extra = []) =>
  ui.Box({
    key,
    flexDirection: 'column',
    width: '100%',
    children: [
      ui.Text({ dimColor: true, children: [name] }),
      ui.Box({ flexDirection: 'column', paddingLeft: SPACE.indent, width: '100%', children: [ui.Text({ wrap: 'wrap', ...props, children: [value] }), ...extra] }),
    ],
  })

/** `field` for a body `room` cells wide: beside its name, or under it when narrow (isStacked). */
export const fieldsFor = (room) => (ui, key, name, value, width = 18, props = {}) =>
  isStacked(room, width, value) ? stackedField(ui, key, name, value, props) : field(ui, key, name, value, width, props)

/** A section: a bold heading, then its body indented under it. */
export const section = (ui, key, title, children) =>
  ui.Box({
    key,
    flexDirection: 'column',
    width: '100%',
    children: [
      ui.Text({ bold: true, children: [title] }),
      ui.Box({ flexDirection: 'column', paddingLeft: SPACE.indent, width: '100%', children }),
    ],
  })

/** A row's details, indented under it. */
export const details = (ui, key, children) =>
  ui.Box({ key, flexDirection: 'column', paddingLeft: SPACE.indent * 2, width: '100%', children })

/** The whole pane: its blocks one blank row apart, inside the page padding. */
export const page = (ui, children) =>
  ui.Box({ flexDirection: 'column', rowGap: SPACE.section, paddingX: SPACE.page, width: '100%', children })
