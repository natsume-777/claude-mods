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
// Around the cards, the hand-over of an earlier session's board:
//   - a board that was taken over (sealed) says it is read-only above its cards, with a button
//     that makes it writable again;
//   - the line about the last hand-over, and where the cards came from;
//   - while the board is empty and other sessions' boards are there, the frame "前のセッション
//     から引き継ぐ": one board opened, several as closed rows ([中身を見る] opens one); [引き継ぐ]
//     copies its cards in, after a confirmation when the board already has cards or a card would
//     be skipped (one whose id is taken);
//   - with cards: a dim line with [表示] that opens the same frame.
// Last, a line when the store is over half full.
//
// The band is one short line, the card count (and a hint: boards to take over, or read-only) with
// a button that opens the pane, drawn at 0 cards too. Cards changed since the person's latest
// prompt add a dim `· 更新 N枚` after the count, stale cards a dim `· 古い N枚` after that. With a
// pinned card (and the setting `bandTitle` on), the title of the pinned card written last follows
// them, in its colour, with its checklist's progress. On a narrow line the title goes first, then
// 古い, then 更新; the hint stays with the label.
//
// Nothing here calls $.ui.invalidate or draws on a timer (in the desktop app every redraw
// rebuilds every mod's drawing, other mods' open panes included).

import { LIMITS, BOARD_NAME, fitBand, fitBandTitle, fitBandRecent, fitBandStale, taskProgress } from './board.js'
import { markLabel, diffLine } from './recent.js'
import { isFoldable, isFolded, foldCut, foldLabel, revOfCard } from './fold.js'
import { mermaidSvg, splitFences } from './mermaid.js'
import { RAINBOW, DEFAULT_PALETTE, colorOf, shapeOf } from './style.js'
import { stampOf, dayStampOf, cardStampOf, storeWarning, originText } from './boards.js'
import { isStaleCard, STALE_LABEL } from './stale.js'
import { SEARCH_PLACEHOLDER, SEARCH_CLEAR, SEARCH_NONE, searchCount, hasSearch, isFiltering, filterCards, inputKey } from './search.js'
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
  const count = Text({ dimColor: true, wrap: 'wrap', children: [`${cards.length} 件 · 書き換えは Claude に頼んでください`] })
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

// ---- The hand-over

const boxed = (key, children) => ({ key, flexDirection: 'column', rowGap: 1, width: '100%', borderStyle: 'round', borderDimColor: true, paddingX: 1, children })

// A board that was taken over by another session: read-only here
function drawSealed(ui, sealed, actions) {
  const { Box, Text, Button } = ui
  return Box(
    boxed('sealed', [
      Text({ bold: true, children: ['読み取り専用'] }),
      Text({
        wrap: 'wrap',
        children: [`この${BOARD_NAME}は ${stampOf(sealed.at)} に、別のセッション（${sealed.toCwdName} · ID ${sealed.toSid8}）へ引き継ぎました。ここでは読むだけで、Claude も書き込めません。`],
      }),
      Box({ key: 'sealed-buttons', flexDirection: 'row', children: [Button({ key: 'unseal', label: 'このセッションで書けるように戻す', variant: 'secondary', onPress: () => actions.unseal() })] }),
      Text({ dimColor: true, wrap: 'wrap', children: ['戻しても、引き継ぎ先のカードはそのまま残ります。'] }),
    ]),
  )
}

// The line about the last hand-over or unsealing (until the pane is opened again)
function drawLast(ui, last) {
  const { Box, Text } = ui
  return Box(boxed('handover-last', [Box({ key: 'handover-last-text', children: [Text({ wrap: 'wrap', children: [last.text] })] })]))
}

// Where the cards on this board came from, for as long as the board keeps the record
function drawFrom(ui, from, now) {
  const { Box, Text } = ui
  const when = typeof from.updatedAt === 'number' ? dayStampOf(from.updatedAt, now) : '時刻不明'
  return Box({
    key: 'handover-from',
    children: [Text({ dimColor: true, wrap: 'wrap', children: [`引き継ぎ元: ${when} · ${from.cwdName} · ID ${from.sid8}（元の${BOARD_NAME}は、そのセッションを開くと読めます）`] })],
  })
}

// The first line of a board's block: when, which folder, how many cards, the id's start
function drawBoardHead(ui, b, now) {
  const { Box, Text } = ui
  return Box({
    key: keyOf('cand-head', b.sid8),
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 2,
    children: [
      Text({ dimColor: true, children: [typeof b.updatedAt === 'number' ? dayStampOf(b.updatedAt, now) : '時刻不明'] }),
      Text({ bold: true, wrap: 'wrap', children: [b.cwdName] }),
      Text({ dimColor: true, children: [`${b.count} 枚`] }),
      Text({ dimColor: true, children: [`ID ${b.sid8}`] }),
    ],
  })
}

// The second line: what the session was about (its title, else the first thing typed in it)
const aboutOf = (b) => (b.title !== null ? b.title : b.firstPrompt !== null ? `「${b.firstPrompt}」` : '最初に打った言葉: 不明')

function drawBoardRow(ui, b, { open, single, hasCards, now }, actions) {
  const name = BOARD_NAME
  const { Box, Text, Button } = ui
  const children = [drawBoardHead(ui, b, now), Box({ key: keyOf('cand-about', b.sid8), children: [Text({ dimColor: true, wrap: 'wrap', children: [aboutOf(b)] })] })]
  if (open) {
    children.push(
      Box({
        key: keyOf('cand-titles', b.sid8),
        flexDirection: 'column',
        children: b.allTitles.map((t) => Text({ wrap: 'wrap', children: [`・${t.title}${t.pinned ? '（固定）' : ''}`] })),
      }),
      Box({
        key: keyOf('cand-note', b.sid8),
        flexDirection: 'column',
        children: [
          Text({
            dimColor: true,
            wrap: 'wrap',
            children: [
              hasCards
                ? `今の${name}のカードの後ろに足します。入る枚数は、押したあとの確認で分かります。`
                : `この${name}に ${b.count} 枚が入ります${b.pinnedCount > 0 ? `（固定の ${b.pinnedCount} 枚も固定のまま）` : ''}。`,
            ],
          }),
          Text({ dimColor: true, wrap: 'wrap', children: [`元の${name}は読み取り専用になり、この一覧から消えます。`] }),
        ],
      }),
    )
  } else {
    const rest = b.count - b.titles.length
    children.push(
      Box({ key: keyOf('cand-titles', b.sid8), children: [Text({ dimColor: true, wrap: 'wrap', children: [b.titles.join(' / ') + (rest > 0 ? ` ほか ${rest} 枚` : '')] })] }),
    )
  }
  const take = Button({ key: 'take-' + b.sid8, label: '引き継ぐ', variant: 'secondary', onPress: () => actions.take(b.sid8) })
  const buttons = single ? [take] : [Button({ key: 'peek-' + b.sid8, label: open ? '閉じる' : '中身を見る', variant: 'secondary', onPress: () => actions.peek(b.sid8) }), take]
  children.push(Box({ key: keyOf('cand-buttons', b.sid8), flexDirection: 'row', columnGap: 1, children: buttons }))
  return Box({ key: keyOf('cand', b.sid8), flexDirection: 'column', children })
}

// The step before a hand-over whose outcome is not plain: what goes in, what is skipped, what does not fit
function drawConfirm(ui, b, confirm, now, actions) {
  const { Box, Text, Button } = ui
  const name = BOARD_NAME
  const { added, duplicates, overflow } = confirm.plan
  // The card limit the plan was made with (the setting `maxCards`); a step staged before it was kept: the default
  const limit = Number.isSafeInteger(confirm.plan.limit) ? confirm.plan.limit : LIMITS.cards
  // By title only: a card's id is Claude's name for it and is not shown in the pane
  const entries = (list, key) => Box({ key, flexDirection: 'column', children: list.map((c) => Text({ wrap: 'wrap', children: [`  ・${c.title}`] })) })
  const pinned = added.filter((c) => c.pinned).length
  const children = [Text({ bold: true, children: ['引き継ぐ前に確認してください'] })]
  if (confirm.recounted) children.push(Text({ wrap: 'wrap', children: [`${name}が変わったので、数え直しました`] }))
  children.push(Text({ wrap: 'wrap', children: [`${originText(b, now)} · ${b.count} 枚 · ID ${b.sid8} から`] }))
  if (added.length > 0) {
    children.push(Text({ wrap: 'wrap', children: [`入る: ${added.length} 枚`] }))
    if (pinned > 0) children.push(Text({ dimColor: true, wrap: 'wrap', children: [`固定の ${pinned} 枚も固定のまま入ります`] }))
  }
  if (duplicates.length > 0) {
    children.push(Text({ wrap: 'wrap', children: [`飛ばす: ${duplicates.length} 枚（今の${name}か最近消したカードに、同じカードがあるため。今のカードはそのまま）`] }), entries(duplicates, 'confirm-skipped'))
  }
  if (overflow.length > 0) {
    children.push(Text({ wrap: 'wrap', children: [`入らない: ${overflow.length} 枚（カードは ${limit} 枚まで）`] }), entries(overflow, 'confirm-overflow'))
    children.push(Text({ dimColor: true, wrap: 'wrap', children: [`入らなかったカードは元の${name}に残り、そのセッションを開けば読めます。`] }))
  }
  const buttons = []
  if (added.length > 0) {
    buttons.push(Button({ key: 'take-confirm', label: 'この内容で引き継ぐ', variant: 'secondary', onPress: () => actions.takeConfirm() }))
  } else {
    // Nothing would go in: say why, and leave only the way out
    const why =
      overflow.length > 0
        ? `今の${name}は ${limit} 枚でいっぱいなので、1 枚も入りません。済んだカードを消してから引き継いでください`
        : `入るカードが 1 枚もありません（すべて、今の${name}か最近消したカードに同じカードがあります）`
    children.push(Text({ wrap: 'wrap', children: [why] }))
  }
  buttons.push(Button({ key: 'take-cancel', label: 'やめる', variant: 'secondary', onPress: () => actions.takeCancel() }))
  children.push(Box({ key: 'confirm-buttons', flexDirection: 'row', columnGap: 1, children: buttons }))
  return Box(boxed('confirm', children))
}

// The frame "前のセッションから引き継ぐ": the boards that may be taken over
function drawHandover(ui, others, hasCards, view, now, actions) {
  const { Box, Text } = ui
  const name = BOARD_NAME
  const single = others.boards.length === 1
  const rows = others.boards.flatMap((b) => {
    const row = drawBoardRow(ui, b, { open: single || view.pick === b.sid8, single, hasCards, now }, actions)
    return view.confirm !== null && view.confirm.sid8 === b.sid8 ? [row, drawConfirm(ui, b, view.confirm, now, actions)] : [row]
  })
  return Box(
    boxed('handover', [
      Text({ bold: true, children: ['前のセッションから引き継ぐ'] }),
      Text({ dimColor: true, wrap: 'wrap', children: [`前のセッションの${name}のカードを、この${name}に写します。元の${name}は消えずに残り、読み取り専用になります。`] }),
      ...(others.notice !== '' ? [Box({ key: 'handover-notice', children: [Text({ wrap: 'wrap', children: [others.notice] })] })] : []),
      ...rows,
      ...(others.more > 0 ? [Box({ key: 'handover-more', children: [Text({ dimColor: true, children: [`ほか ${others.more} 件`] })] })] : []),
    ]),
  )
}

// With cards on the board: one dim line and a button that opens the frame
function drawEntry(ui, others, view, actions) {
  const { Box, Text, Button } = ui
  return Box({
    key: 'handover-entry',
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 2,
    alignItems: 'center',
    children: [
      Text({ dimColor: true, wrap: 'wrap', children: [`前のセッションの${BOARD_NAME}を引き継ぐこともできます（${others.boards.length + others.more} 件）`] }),
      Button({ key: 'show-handover', label: view.shown ? '隠す' : '表示', variant: 'secondary', onPress: () => actions.toggleShown() }),
    ],
  })
}

/**
 * The pane's tree. `data` is what register.js read from $.state: { cards, others, handover:
 * { sealed, from, last }, view: { pick, shown, confirm, searchGen (search.js inputKey) }, enabled (the setting `handover`),
 * now, palette (style.js), marks (recent.js: the cards changed since the
 * person's latest prompt, by id), folds (fold.js: the person's fold choices, by id), filter
 * (search.js: the search field's text, '' for none), order (order.js: 'added' or 'updated'), ownBytes
 * (the JSON size of this session's keys as stored, the cards' previous versions and the removed
 * cards included; null when unknown, the shown cards are counted then), staleHours (stale.js: the
 * setting, 0 for off), shapes (style.js: the setting `styleMarks`) }; `where` is
 * { surface, columns }; `actions` the Buttons' work.
 */
export function drawPane(ui, data, where, actions) {
  const { cards, others, handover, view, enabled, now, palette, marks = {}, folds = {}, filter = '', order = 'added', ownBytes = null, staleHours = 0, shapes = false } = data
  const { Box, Text } = ui
  const sealed = handover.sealed !== null
  const offered = enabled && !sealed
  const warning = storeWarning(others.bytes + (typeof ownBytes === 'number' ? ownBytes : JSON.stringify(cards).length))
  const children = [
    ...(sealed ? [drawSealed(ui, handover.sealed, actions)] : []),
    ...(handover.last !== null ? [drawLast(ui, handover.last)] : []),
    ...(handover.from !== null ? [drawFrom(ui, handover.from, now)] : []),
    ...drawCards(ui, cards, { ...where, now, palette, marks, folds, filter, order, searchGen: view.searchGen ?? 0, staleHours, shapes }, actions),
    ...(offered && cards.length === 0 && (others.boards.length > 0 || others.notice !== '') ? [drawHandover(ui, others, false, view, now, actions)] : []),
    ...(offered && cards.length > 0 && (others.boards.length > 0 || view.shown) ? [drawEntry(ui, others, view, actions)] : []),
    ...(offered && cards.length > 0 && view.shown ? [drawHandover(ui, others, true, view, now, actions)] : []),
    ...(warning !== '' ? [Box({ key: 'store-warning', children: [Text({ dimColor: true, wrap: 'wrap', children: [warning] })] })] : []),
  ]
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
