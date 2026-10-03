// The look every view of this mod shares: spacing, column widths, colors, button roles, and
// small builders for the recurring blocks (a view's header, a section, a table row, a
// key/value field, a card). Pure: each builder takes the element table `$.ui.resolve(e)`
// handed out (`ui`) and never touches $, so the drawing files keep every $ call themselves.

/** Spacing, in character cells. */
export const SPACE = {
  page: 1, // the left and right padding of a whole view
  section: 1, // blank rows between a view's sections
  item: 1, // blank rows between multi-line items (the contents' categories)
  row: 0, // blank rows between the lines of a text-only field list
  control: 1, // blank rows between table rows that hold buttons, and between wrapped buttons
  inline: 1, // columns between buttons in a row
  mark: 2, // columns between a switch's mark and its button
  column: 2, // columns between the cells of a table row
  indent: 2, // the indent of a section's body under its heading
}

/** Fixed column widths, in character cells, so rows line up as a table. */
export const WIDTH = {
  label: 22, // a site's `[name]`: the longest is 22
  state: 11, // the on/off mark, its gap and its button
  count: 5, // `999 回`
  detail: 8, // the [詳細] button
  category: 14, // a category's name in the contents
  field: 20, // a field's name in a key/value list
  prop: 16, // a prop's name in the detail card
  value: 30, // a value's `[noun.method]` in the values view: `[classic.UserPromptExpansion]` is 29
}

/**
 * The palette: theme color names only, so the surface's theme decides the shade. Secondary
 * text is drawn with dimColor rather than a color of its own.
 */
export const COLOR = {
  on: 'success', // a switch that is on
  warn: 'warning', // something the surface does not draw
}

/**
 * Button roles, spread into a Button's props.
 * main: the one action a view leads to (show the samples), and the picked one of several
 *       choices (an open [詳細], the chosen way of drawing).
 * nav: moving between views, refreshing, closing, a switch that is on.
 * minor: an unpicked choice, a [詳細] not open, a switch that is off.
 * The run buttons of the APIs keep the surface's default look.
 */
export const BUTTON = {
  main: { variant: 'primary' },
  nav: { variant: 'secondary' },
  minor: { variant: 'secondary', dimColor: true },
}

/** The role of a button that is one of several choices: picked is main, the rest minor. */
export const choice = isPicked => (isPicked ? BUTTON.main : BUTTON.minor)

/** Dim text that wraps at the pane's edge. */
export const dim = (ui, key, text) => ui.Text({ key, dimColor: true, wrap: 'wrap', children: [text] })

/** A row of buttons (or other inline items), wrapping when the pane is narrow. */
export const inline = (ui, key, children, marginTop = 0, gap = SPACE.inline) =>
  ui.Box({
    key,
    marginTop,
    flexDirection: 'row',
    columnGap: gap,
    rowGap: SPACE.control,
    alignItems: 'center',
    flexWrap: 'wrap',
    children,
  })

/** A cell of fixed width; it never shrinks, so the next cell starts at the same column. */
export const cell = (ui, width, children, align = 'flex-start') =>
  ui.Box({ width, flexShrink: 0, flexDirection: 'row', justifyContent: align, children })

/**
 * The last cell of a row: takes the rest of the width. 'row' lays inline items out and wraps
 * them inside the cell; 'column' stacks lines of text that wrap at the cell's edge.
 */
export const fill = (ui, children, direction = 'row') =>
  ui.Box({
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: direction,
    columnGap: SPACE.inline,
    rowGap: direction === 'row' ? SPACE.control : 0,
    alignItems: direction === 'row' ? 'center' : 'stretch',
    flexWrap: direction === 'row' ? 'wrap' : 'nowrap',
    children,
  })

/** A table row: fixed cells then a fill, on one line. */
export const tableRow = (ui, key, children, align = 'center') =>
  ui.Box({ key, flexDirection: 'row', columnGap: SPACE.column, alignItems: align, width: '100%', children })

/** A key/value line: the name dim in a fixed column, the value in normal text (or nodes). */
export const field = (ui, key, name, value, width = WIDTH.field) =>
  tableRow(
    ui,
    key,
    [
      cell(ui, width, [ui.Text({ dimColor: true, children: [name] })]),
      typeof value === 'string' ? fill(ui, [ui.Text({ wrap: 'wrap', children: [value] })], 'column') : fill(ui, value),
    ],
    'flex-start',
  )

/**
 * A view's header: the title, a one-line description, the navigation buttons in one row,
 * and an optional note under them.
 */
export const header = (ui, { title, about, nav, note }) =>
  ui.Box({
    key: 'header',
    flexDirection: 'column',
    width: '100%',
    children: [
      ui.Text({ bold: true, children: [title] }),
      about ? dim(ui, 'header-about', about) : null,
      nav && nav.length > 0 ? inline(ui, 'header-nav', nav, 1) : null,
      note ? ui.Box({ key: 'header-note', marginTop: 1, children: [dim(ui, 'header-note-text', note)] }) : null,
    ],
  })

/** A section: a bold heading, then its body indented under it. */
export const section = (ui, key, title, children, gap = SPACE.row) =>
  ui.Box({
    key,
    flexDirection: 'column',
    width: '100%',
    children: [
      ui.Text({ bold: true, children: [title] }),
      ui.Box({ flexDirection: 'column', rowGap: gap, paddingLeft: SPACE.indent, width: '100%', children }),
    ],
  })

/** A framed block: a dim rounded border with room inside. */
export const card = (ui, key, children) =>
  ui.Box({
    key,
    flexDirection: 'column',
    rowGap: SPACE.section,
    width: '100%',
    borderStyle: 'round',
    borderDimColor: true,
    paddingX: 2,
    paddingY: 1,
    children,
  })

/** A whole view: its sections one blank row apart, inside the page padding. */
export const page = (ui, children) =>
  ui.Box({ flexDirection: 'column', rowGap: SPACE.section, paddingX: SPACE.page, width: '100%', children })

/**
 * A table: its rows (each a row with whatever hangs under it, such as a result line) one
 * blank row apart, so the buttons of adjacent rows do not touch.
 */
export const table = (ui, key, rows) =>
  ui.Box({ key, flexDirection: 'column', rowGap: SPACE.control, width: '100%', children: rows })

/** The mark in front of a switch: a colored dot when on, a dim ring when off. */
export const stateMark = (ui, isOn) =>
  isOn ? ui.Text({ color: COLOR.on, children: ['●'] }) : ui.Text({ dimColor: true, children: ['○'] })
