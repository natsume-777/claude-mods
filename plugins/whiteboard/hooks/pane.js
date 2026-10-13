// What the pane and the band draw (pure: no $ here; register.js reads the state, hands the values
// over with the actions the Buttons run, and registers the hooks).
//
// The pane holds the cards, the pinned ones first and each group in the order they were added: a
// title on a line of its own, then a dim line with the checklist's progress (`3/5`, `5/5 済`; only
// for a body with task-list items), 新規 or 更新 for a card Claude changed since the person's latest
// prompt (recent.js; a changed card also gets `+3 −1 行` after it), 固定, 古い and the time of the
// last write (never the card's id, which is Claude's name for it), and the body as Markdown (handed
// over as written, except that a mermaid fence mermaid.js can draw is an Svg). No button changes a
// card: the person reads, Claude writes. A long card is folded to its first lines with a secondary
// button [続きを表示（残り N 行）], an opened one has [畳む] after its body (fold.js; the view
// only). With 6 cards or more, a search field over them narrows the cards drawn to those holding
// every word typed, drawn whole while it does (search.js; the view only). With 3 cards or more, a
// secondary button beside the count switches the order to the latest write first, the pinned ones still
// first (order.js; the view only). With none, a note says
// so. A card with a single-colour
// style draws its border (bold) and title in that colour (the palette, style.js), with the setting
// `styleMarks` a shape of its own before the title (style.js SHAPES); the rainbow draws a
// stripe of seven hues across its top and its title one character a hue, the border as any card's.
// A stale card (stale.js: not pinned, not marked this turn, not written for `staleHours` hours) has
// a dim 古い before the time on its meta line, its title dim instead of its colour and its border
// dimmed (the rainbow's stripe is left out); it is only pointed out, never removed.
//
// The cards are those of the board the session is attached to (boards.js), under the board's name
// as one Markdown heading (escaped, so it shows as typed); at the very bottom one row of the
// board's tools ([別のボードへ], [名前を変える], [読み直す]), always shown. A session attached to no board has the list
// instead of the cards: this project's boards newest first (name and time, the session that wrote
// it last, the card titles, [つなぐ] and [中身を見る]), the other projects' and the old boards folded
// under a line with [表示], [読み直す] at the bottom. A board's id is never shown. What an action did
// is a toast (register.js), never a line in the pane. A line when the store is over half full.
//
// The band is one short line, the card count (or, attached to no board, a hint to choose one) with
// a button that opens the pane, drawn at 0 cards too. Cards changed since the person's latest
// prompt add a dim `· 更新 N枚` after the count, stale cards a dim `· 古い N枚` after that. With a
// pinned card (and the setting `bandTitle` on), the title of the pinned card written last follows
// them, in its colour, with its checklist's progress. On a narrow line the title goes first, then
// 古い, then 更新; the hint stays with the label.
//
// Nothing here calls $.ui.invalidate or draws on a timer (in the desktop app every redraw
// rebuilds every mod's drawing, other mods' open panes included).

import { BOARD_NAME, fitBand, fitBandTitle, fitBandRecent, fitBandStale, taskProgress } from './board.js'
import { markLabel, diffLine } from './recent.js'
import { isFoldable, isFolded, foldCut, foldLabel, revOfCard } from './fold.js'
import { mermaidSvg, splitFences } from './mermaid.js'
import { RAINBOW, DEFAULT_PALETTE, colorOf, shapeOf } from './style.js'
import { dayStampOf, cardStampOf, storeWarning, groupBoards, titlesLine, UNKNOWN_FOLDER } from './boards.js'
import { isStaleCard, STALE_LABEL } from './stale.js'
import { SEARCH_PLACEHOLDER, SEARCH_CLEAR, SEARCH_NONE, searchCount, hasSearch, hasInput, isFiltering, filterCards, inputKey } from './search.js'
import { ORDER_LABELS, hasOrder, sortCards } from './order.js'

// The pane's title is the board's name (board.js BOARD_NAME), given where register.js opens it
export const PANE_ID = 'whiteboard'

// Element keys allow a plain set of characters; a card's id is checked to, but not trusted to
const keyOf = (prefix, id) => prefix + '-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_')

// The cells across a drawing: the site's own width, else what the surface measured; null when
// neither is known
export function widthOf(e) {
  const n = e.props?.bodyColumns
  if (typeof n === 'number' && n > 0) return n
  const v = e.viewport?.columns
  return typeof v === 'number' && v > 0 ? v : null
}

// A card's body. The Markdown element shows a mermaid fence as a code block, so on a surface with
// Svg the fences mermaid.js can draw become pictures, the rest of the body staying Markdown as
// written (a fence it cannot draw too). With none drawn the body is one Markdown, untouched.
function drawBody(ui, card, view) {
  const { Box, Markdown, Svg } = ui
  const whole = () => Markdown({ key: keyOf('body', card.id), text: card.body })
  if (view.surface === 'terminal' || typeof Svg !== 'function' || !/mermaid/i.test(card.body)) return whole()
  const items = []
  let drawn = 0
  const addText = (text) => {
    if (items.at(-1)?.text !== undefined) items[items.length - 1].text += '\n' + text
    else items.push({ text })
  }
  for (const piece of splitFences(card.body)) {
    const picture = piece.type === 'mermaid' ? mermaidSvg(piece.source) : null
    if (picture) {
      items.push({ picture })
      drawn++
    } else {
      addText(piece.type === 'mermaid' ? piece.raw : piece.text)
    }
  }
  if (drawn === 0) return whole()
  // About the cells of the pane less its borders and padding, at 8 pixels a cell
  const room = view.columns ? Math.max(160, (view.columns - 8) * 8) : 560
  const children = items.flatMap((item, n) => {
    if (item.text !== undefined) return item.text.trim() === '' ? [] : [Markdown({ key: keyOf('body', card.id) + '-' + n, text: item.text })]
    const { picture } = item
    const scale = Math.min(1, room / picture.width)
    return [
      Box({
        key: keyOf('diagram', card.id) + '-' + n,
        children: [Svg({ source: picture.source, alt: picture.alt, width: Math.round(picture.width * scale), height: Math.round(picture.height * scale) })],
      }),
    ]
  })
  return Box({ key: keyOf('body', card.id), flexDirection: 'column', rowGap: 1, children })
}

// The rainbow's title: one hue a character, cycling through RAINBOW; blanks take none
function rainbowTitle(ui, title) {
  const { Text } = ui
  let n = 0
  const parts = [...title].map((ch) => (/\s/.test(ch) ? ch : Text({ color: RAINBOW[n++ % RAINBOW.length], children: [ch] })))
  return Text({ bold: true, wrap: 'wrap', children: parts })
}

// The rainbow's stripe: seven Boxes side by side, one fixed hue each
function rainbowStripe(ui, card) {
  const { Box, Text } = ui
  return Box({
    key: keyOf('stripe', card.id),
    flexDirection: 'row',
    width: '100%',
    children: RAINBOW.map((hex, i) => Box({ key: keyOf('stripe', card.id) + '-' + i, flexGrow: 1, height: 1, backgroundColor: hex, children: [Text({ children: [' '] })] })),
  })
}

// A long card's button: [続きを表示（残り N 行）] when folded, [畳む] when open; it only changes the view.
// Secondary, not plain: a plain Button is drawn as bare text, which does not look pressable.
// The key says what the press does (`fold-open-<id>` / `fold-close-<id>`), so a press aimed at a
// drawing that has since been replaced (press-guard.js runs the latest drawing's closure under the
// same key) finds no handler once the card has turned the other way, rather than undoing the intent.
function drawFoldButton(ui, card, folded, remaining, onFold) {
  const { Box, Button } = ui
  return Box({
    key: keyOf('fold-row', card.id),
    flexDirection: 'row',
    children: [Button({ key: keyOf(folded ? 'fold-open' : 'fold-close', card.id), label: foldLabel(folded, remaining), variant: 'secondary', onPress: () => onFold(card.id, folded, revOfCard(card)) })],
  })
}

function drawCard(ui, card, view, onFold) {
  const { Box, Text } = ui
  const rainbow = card.style === 'rainbow'
  const color = colorOf(card.style, view.palette ?? DEFAULT_PALETTE)
  // Changed since the person's latest prompt (recent.js): a dim word, and the lines it moved
  const mark = view.marks?.[card.id]
  const marked = markLabel(mark)
  const diff = diffLine(mark)
  // Not written for a while (stale.js): a dim 古い, the title dim instead of its colour, the border dimmed, no stripe
  const stale = isStaleCard(card, view.now, view.staleHours, mark !== undefined)
  // The setting `styleMarks`: the style's shape before the title, in the title's colour (dim when stale)
  const shape = view.shapes === true ? shapeOf(card.style) : null
  const tint = stale ? { dimColor: true } : color !== null ? { color } : {}
  const words = shape !== null ? [Text({ ...tint, children: [shape] }), ' ' + card.title] : [card.title]
  const title = stale
    ? Text({ bold: true, dimColor: true, wrap: 'wrap', children: words })
    : rainbow
      ? rainbowTitle(ui, card.title)
      : Text({ bold: true, wrap: 'wrap', ...(color !== null ? { color } : {}), children: words })
  // The checklist's progress, dim like the rest of the meta line and never coloured by the style
  const progress = taskProgress(card.body)
  // The meta line under the title: dim words, the time last. The card's id is Claude's name for
  // it and is not shown.
  const meta = [
    ...(progress !== '' ? [Text({ dimColor: true, children: [progress] })] : []),
    ...(marked !== '' ? [Text({ dimColor: true, children: [marked] })] : []),
    ...(diff !== '' ? [Box({ key: keyOf('diff', card.id), children: [Text({ dimColor: true, children: [diff] })] })] : []),
    ...(card.pinned === true ? [Text({ dimColor: true, children: ['固定'] })] : []),
    ...(stale ? [Text({ dimColor: true, children: [STALE_LABEL] })] : []),
    Text({ dimColor: true, children: [cardStampOf(card.updatedAt, view.now)] }),
  ]
  const children = [
    // A stale card shows no stripe: its colours are let go like the title's
    ...(rainbow && !stale ? [rainbowStripe(ui, card)] : []),
    // The header in two lines: the title alone (wrapping), then the meta line
    Box({
      key: keyOf('head', card.id),
      flexDirection: 'column',
      children: [
        Box({ key: keyOf('title', card.id), children: [title] }),
        Box({ key: keyOf('meta', card.id), flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: meta }),
      ],
    }),
  ]
  // A drawable mermaid fence counts as one line where the pane draws pictures (drawBody)
  const lines = { pictures: view.surface !== 'terminal' && typeof ui.Svg === 'function' }
  // While the search field narrows the cards, every card drawn is whole and has no fold button: the
  // words may have matched in the lines a fold leaves out, and a folded card would hide why it is
  // there. The person's fold choices are kept and come back once the filter is cleared.
  if (!view.filtering && isFoldable(card.body, lines)) {
    // Folded: the first lines as fold.js cuts them (never none: such a card does not fold), then the button
    const folded = isFolded(card, view.folds?.[card.id], mark !== undefined, lines)
    const cut = folded ? foldCut(card.body, lines) : null
    children.push(drawBody(ui, folded ? { ...card, body: cut.text } : card, view))
    children.push(drawFoldButton(ui, card, folded, folded ? cut.remaining : 0, onFold))
  } else if (card.body.trim() !== '') {
    children.push(drawBody(ui, card, view))
  }
  // A single-colour card has a bold border in its colour (dimmed when stale), so it stands out from
  // the thin round dim border of a card with no style and of the rainbow
  const border = color !== null ? { borderStyle: 'bold', borderColor: color, ...(stale ? { borderDimColor: true } : {}) } : { borderStyle: 'round', borderDimColor: true }
  return Box({ key: keyOf('card', card.id), flexDirection: 'column', width: '100%', ...border, paddingX: 1, children })
}

// The cards' blocks: a note and a box each, or what to ask for while there are none
function drawCards(ui, cards, view, actions) {
  const { Box, Text } = ui
  if (cards.length === 0) {
    return [
      Box({ key: 'empty', flexDirection: 'column', children: [
        Text({ wrap: 'wrap', children: ['まだ何も書かれていません'] }),
        Text({ dimColor: true, wrap: 'wrap', children: [`Claude に「${BOARD_NAME}に手順を書いて」のように頼むと、ここにカードとして残ります`] }),
      ] }),
    ]
  }
  // The fold's choice keeps only the cards on the board (fold.js foldsAfter), every one of them
  // even while the search field leaves some out, so a filter never lets a choice go
  const ids = cards.map((c) => c.id)
  const onFold = (id, open, rev) => actions.fold?.(id, open, rev, ids)
  // The search field (search.js): with enough cards and an Input the surface draws; the words
  // apply only while it is drawn
  const searching = hasSearch(cards, ui, view.surface)
  const text = searching ? view.filter ?? '' : ''
  const filtering = isFiltering(text)
  const shown = filtering ? filterCards(cards, text) : cards
  // The order button (order.js): with enough cards; with fewer the added order is drawn
  const ordering = hasOrder(cards)
  const by = ordering && view.order === 'updated' ? 'updated' : 'added'
  const count = Text({ dimColor: true, wrap: 'wrap', children: [`${cards.length} 件`] })
  return [
    Box({
      key: 'about',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 2,
      alignItems: 'center',
      children: ordering ? [count, drawOrderButton(ui, by, actions)] : [count],
    }),
    ...(searching ? [drawSearch(ui, view.searchGen, filtering ? { total: cards.length, shown: shown.length } : null, actions)] : []),
    ...(filtering && shown.length === 0 ? [Box({ key: 'search-none', children: [Text({ wrap: 'wrap', children: [SEARCH_NONE] })] })] : []),
    ...sortCards(shown, by).map((card) => drawCard(ui, card, { ...view, filtering }, onFold)),
  ]
}

// The order button: its label names the order drawn now, a press switches to the other. Secondary,
// as the fold's: a plain Button is drawn as bare text, which does not look pressable. The key
// says what the press does (`order-updated` switches to the newest first, `order-added` back), so
// a press aimed at a replaced drawing finds no handler once the order has turned, as the fold's.
function drawOrderButton(ui, by, actions) {
  const { Button } = ui
  const to = by === 'updated' ? 'added' : 'updated'
  return Button({ key: 'order-' + to, label: ORDER_LABELS[by], variant: 'secondary', onPress: () => actions.order?.(to) })
}

// The search field over the cards; while it narrows (`count` { total, shown }), a dim line with
// the counts and a plain button that clears it. The field types live (onInput, every change) and
// Enter does the same (onSubmit, which an Input must have). The field keeps its own text (no
// `value`); [絞り込みを解く] moves `gen` on, so the field is drawn under a new key, empty (search.js).
function drawSearch(ui, gen, count, actions) {
  const { Box, Text, Button, Input } = ui
  const onText = (value) => actions.filter?.(value)
  const children = [Input({ key: inputKey(gen), placeholder: SEARCH_PLACEHOLDER, onInput: onText, onSubmit: onText })]
  if (count !== null) {
    children.push(
      Box({
        key: 'search-status',
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 2,
        alignItems: 'center',
        children: [
          Text({ dimColor: true, children: [searchCount(count.total, count.shown)] }),
          Button({ key: 'search-clear', label: SEARCH_CLEAR, variant: 'secondary', onPress: () => actions.clearFilter?.() }),
        ],
      }),
    )
  }
  return Box({ key: 'search', flexDirection: 'column', children })
}

// ---- The board's name, and the list of boards

const boxed = (key, children) => ({ key, flexDirection: 'column', rowGap: 1, width: '100%', borderStyle: 'round', borderDimColor: true, paddingX: 1, children })

// A text as Markdown shows it literally: line breaks and blanks as one blank, every ASCII
// punctuation mark escaped with a backslash (CommonMark lets any of them be escaped)
export const markdownLiteral = (text) => String(text ?? '').replace(/\s+/g, ' ').replace(/[!-/:-@[-`{-~]/g, (ch) => '\\' + ch)

// A heading (`## …`): the one way the pane has to draw text larger than the cards' (Text has no size)
const heading = (ui, key, text) => ui.Markdown({ key, text: '## ' + markdownLiteral(text) })

// The name of the board the session is attached to: one heading above the cards
function drawBoardName(ui, attached) {
  return heading(ui, 'board-name', attached.name)
}

// One board in the list: its name and time, the session that wrote it last, its card titles (all
// of them once opened), [つなぐ] and [中身を見る]. `folder` adds the folder for another project's.
function drawBoardRow(ui, row, { open, folder, now }, actions) {
  const { Box, Text, Button } = ui
  const head = [
    Text({ bold: true, wrap: 'wrap', children: [row.name] }),
    ...(folder ? [Text({ dimColor: true, wrap: 'wrap', children: [row.cwdName] })] : []),
    Text({ dimColor: true, children: [typeof row.updatedAt === 'number' ? dayStampOf(row.updatedAt, now) : '時刻不明'] }),
  ]
  const children = [Box({ key: keyOf('row-head', row.id), flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: head })]
  if (row.lastTitle) children.push(Box({ key: keyOf('row-about', row.id), children: [Text({ dimColor: true, wrap: 'wrap', children: [`最後に書いたセッション: ${row.lastTitle}`] })] }))
  if (open && row.titles.length > 0) {
    children.push(
      Box({
        key: keyOf('row-titles', row.id),
        flexDirection: 'column',
        children: row.titles.map((t) => Text({ wrap: 'wrap', children: [`・${t.title}${t.pinned ? '（固定）' : ''}${t.progress !== '' ? ' ' + t.progress : ''}`] })),
      }),
    )
  } else {
    children.push(Box({ key: keyOf('row-titles', row.id), children: [Text({ dimColor: true, wrap: 'wrap', children: [titlesLine(row)] })] }))
  }
  const buttons = [Button({ key: keyOf('attach', row.id), label: 'つなぐ', variant: 'secondary', onPress: () => actions.attach?.(row.id) })]
  if (row.count > 0) buttons.push(Button({ key: keyOf('peek', row.id), label: open ? '閉じる' : '中身を見る', variant: 'secondary', onPress: () => actions.peek?.(row.id) }))
  children.push(Box({ key: keyOf('row-buttons', row.id), flexDirection: 'row', columnGap: 1, children: buttons }))
  return Box({ ...boxed(keyOf('row', row.id), children), rowGap: 0 })
}

// A folded group (the other projects' boards, the old boards): its name and count with [表示] /
// [隠す], and its rows while it is shown
function drawGroup(ui, name, label, rows, open, { now, pick, folder }, actions) {
  const { Box, Text, Button } = ui
  if (rows.length === 0) return []
  const line = Box({
    key: 'group-' + name,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 2,
    alignItems: 'center',
    children: [Text({ wrap: 'wrap', children: [`${label}（${rows.length}）`] }), Button({ key: 'show-' + name, label: open ? '隠す' : '表示', variant: 'secondary', onPress: () => actions.group?.(name, !open) })],
  })
  return [line, ...(open ? rows.map((r) => drawBoardRow(ui, r, { open: pick === r.id, folder: folder(r), now }, actions)) : [])]
}

/**
 * The list of boards to attach to: this project's newest first, then the other projects' and the
 * old boards, each folded under a line with [表示]. `except` (a board id or null) is left out: the
 * board the session is attached to. `reload` puts [読み直す] at its bottom (attached to none; when
 * attached it is in the board's tools). Answers the blocks.
 */
function drawChooser(ui, { rows, root, except, title, view, now, reload = false }, actions) {
  const { Box, Text } = ui
  const groups = groupBoards(rows, { rootHash: root?.hash ?? null, except })
  const where = root?.name ?? UNKNOWN_FOLDER
  // Attached to none the list is the whole pane, and its title a heading; in the board's tools, a bold line
  const blocks = [reload ? heading(ui, 'chooser-heading', title) : Text({ bold: true, wrap: 'wrap', children: [title] })]
  if (groups.mine.length > 0) {
    blocks.push(Text({ wrap: 'wrap', children: [`このプロジェクト（${where}）のボード`] }))
    for (const r of groups.mine) blocks.push(drawBoardRow(ui, r, { open: view.pick === r.id, folder: false, now }, actions))
  } else {
    blocks.push(Text({ wrap: 'wrap', children: [`このプロジェクト（${where}）のボードは、まだありません`] }))
  }
  blocks.push(...drawGroup(ui, 'others', 'ほかのプロジェクトのボード', groups.others, view.groups.others, { now, pick: view.pick, folder: () => true }, actions))
  blocks.push(...drawGroup(ui, 'old', '古いボード', groups.old, view.groups.old, { now, pick: view.pick, folder: (r) => r.rootHash !== (root?.hash ?? null) }, actions))
  blocks.push(Text({ dimColor: true, wrap: 'wrap', children: [`新しい${BOARD_NAME}は、Claude に「◯◯のボードを作って」と頼むとできます`] }))
  if (reload) blocks.push(Box({ key: 'chooser-foot', flexDirection: 'row', children: [reloadButton(ui, actions)] }))
  return [Box({ key: 'chooser', flexDirection: 'column', rowGap: 1, width: '100%', children: blocks })]
}

// [読み直す]: the board and the list from the store now (another session may have written them)
const reloadButton = (ui, actions) => ui.Button({ key: 'reload', label: '読み直す', variant: 'secondary', onPress: () => actions.reload?.() })

// The board's tools, at the very bottom of an attached pane: one row of three secondary buttons,
// always shown, each saying what it does: [別のボードへ], [名前を変える] (left out where no Input is
// drawn) and [読み直す]. [名前を変える] puts an Input in the row's place (drawn under a new key each
// time, so it starts empty) with [やめる]; [別のボードへ] puts the list of the other boards there,
// with [やめる] at its bottom. A rename that is done, or a board attached to, brings the row back.
function drawTools(ui, attached, view, canInput, chooser, actions) {
  const { Box, Button, Input } = ui
  const cancel = (key, onPress) => Box({ key: key + '-row', flexDirection: 'row', children: [Button({ key, label: 'やめる', variant: 'secondary', onPress })] })
  if (view.rename && canInput) {
    const key = 'rename-input' + (view.renameGen > 0 ? '-' + view.renameGen : '')
    return [
      Box({
        key: 'board-tools',
        flexDirection: 'column',
        rowGap: 1,
        width: '100%',
        children: [Input({ key, label: '新しい名前', placeholder: attached.name, submitLabel: '変える', onSubmit: (value) => actions.rename?.(value) }), cancel('rename-cancel', () => actions.renameCancel?.())],
      }),
    ]
  }
  if (view.shown) {
    return [Box(boxed('board-tools', [...chooser(attached.board, '切り替えるボードを選ぶ'), cancel('switch-cancel', () => actions.toggleShown?.())]))]
  }
  return [
    Box({
      key: 'board-tools',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 1,
      children: [
        Button({ key: 'switch', label: '別のボードへ', variant: 'secondary', onPress: () => actions.toggleShown?.() }),
        ...(canInput ? [Button({ key: 'rename', label: '名前を変える', variant: 'secondary', onPress: () => actions.renameOpen?.() })] : []),
        reloadButton(ui, actions),
      ],
    }),
  ]
}

/**
 * The pane's tree. `data` is what register.js read from $.state: { attached ({ board, name }, board
 * null for a session attached to no board), cards, boards: { rows, bytes } (view-state.js boardsOf),
 * root ({ name, hash } or null), view (view-state.js viewOf), now, palette (style.js), marks
 * (recent.js: the cards changed since the person's latest prompt, by id), folds (fold.js: the
 * person's fold choices, by id), filter (search.js: the search field's text, '' for none), order
 * (order.js: 'added' or 'updated'), staleHours (stale.js: the setting, 0 for off), shapes (style.js:
 * the setting `styleMarks`) }; `where` is { surface, columns }; `actions` the Buttons' work.
 *
 * Only what the board is for: attached, the board's name as one heading, then the cards, and at
 * the very bottom one row of the board's tools, each saying what it does (drawTools). Not attached: the list, to choose
 * one ([つなぐ]), with [読み直す] at its bottom. What an action did is said in a toast, never in the
 * pane. The one line kept beside the cards is the warning that the store is over half full: it is
 * a lasting state the person has to act on, not a report. It comes above the tools.
 */
export function drawPane(ui, data, where, actions) {
  const { attached, cards, boards, root = null, view, now, palette, marks = {}, folds = {}, filter = '', order = 'added', staleHours = 0, shapes = false } = data
  const { Box, Text } = ui
  const warning = storeWarning(boards.bytes)
  const canInput = hasInput(ui, where.surface)
  const isAttached = attached !== null && attached.board !== null
  const chooser = (except, title) => drawChooser(ui, { rows: boards.rows, root, except, title, view, now, reload: except === null }, actions)
  const warn = warning !== '' ? [Box({ key: 'store-warning', children: [Text({ dimColor: true, wrap: 'wrap', children: [warning] })] })] : []
  const children = isAttached
    ? [
        drawBoardName(ui, attached),
        ...drawCards(ui, cards, { ...where, now, palette, marks, folds, filter, order, searchGen: view.searchGen ?? 0, staleHours, shapes }, actions),
        ...warn,
        ...drawTools(ui, attached, view, canInput, chooser, actions),
      ]
    : [...chooser(null, 'つなぐボードを選ぶ'), ...warn]
  return ui.Box({ key: 'whiteboard', flexDirection: 'column', rowGap: 1, paddingX: 1, width: '100%', children })
}

// The band's "· title progress": the title in the card's single colour (the rainbow and no style
// plain), the progress dim. The only part that may shrink: its Text cuts at the edge with an
// ellipsis should the estimate of the line's room be short.
function drawBandTitle(ui, part, color, shape) {
  const { Box, Text } = ui
  const tint = color !== null ? { color } : {}
  return Box({
    key: 'board-title',
    flexShrink: 1,
    minWidth: 0,
    children: [
      Text({
        wrap: 'truncate-end',
        children: [
          '· ',
          // The setting `styleMarks`: the style's shape before the title, in the same colour
          ...(shape !== null ? [Text({ ...tint, children: [shape + ' '] })] : []),
          Text({ ...tint, children: [part.title] }),
          ...(part.progress !== '' ? [Text({ dimColor: true, children: [' ' + part.progress] })] : []),
        ],
      }),
    ],
  })
}

/**
 * The band's tree; `hint` is '' or the few words after the count; `onOpen` is what [開く] does.
 * `card` is the pinned card whose title follows the counts (board.js bandCard), or null; `palette`
 * gives its colour (style.js); `changed` is how many cards on the board were changed since the
 * person's latest prompt (a dim `· 更新 N枚` after the label); `stale` how many cards are stale
 * (stale.js: a dim `· 古い N枚` after it). The room goes to the label and [開く], then 更新, then
 * 古い, then the title, which is the first to go. `shapes` is the setting `styleMarks` (the
 * style's shape before the title).
 */
export function drawBand(ui, surface, columns, count, hint, onOpen, { card = null, palette = DEFAULT_PALETTE, changed = 0, stale = 0, shapes = false } = {}) {
  const { Box, Text, Button } = ui
  const fit = fitBand({ surface, columns, count, hint })
  // The room goes to 更新 first, then 古い, then the title (board.js)
  const recent = fitBandRecent({ surface, columns, count, hint, changed })
  const old = fitBandStale({ surface, columns, count, hint, recent, stale })
  const shape = card !== null && shapes === true ? shapeOf(card.style) : null
  const part = card !== null ? fitBandTitle({ surface, columns, count, hint, title: card.title, progress: taskProgress(card.body), recent, old, shape: shape ?? '' }) : null
  const children = []
  if (fit.hasLabel) children.push(Box({ key: 'board-label', flexShrink: 0, children: [Text({ children: [fit.label] })] }))
  if (recent !== '') children.push(Box({ key: 'board-recent', flexShrink: 0, children: [Text({ dimColor: true, children: [recent] })] }))
  if (old !== '') children.push(Box({ key: 'board-stale', flexShrink: 0, children: [Text({ dimColor: true, children: [old] })] }))
  if (part !== null) children.push(drawBandTitle(ui, part, colorOf(card.style, palette), shape))
  children.push(
    Box({ key: 'board-open-slot', flexShrink: 0, children: [Button({ key: 'board-open', label: fit.buttonLabel, variant: 'secondary', onPress: onOpen })] }),
  )
  return Box({ key: 'whiteboard-band', flexDirection: 'row', flexWrap: 'nowrap', columnGap: 1, alignItems: 'center', children })
}
