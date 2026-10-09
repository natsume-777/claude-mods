// What the pane and the band draw (pure: no $ here; register.js reads the state, hands the values
// over with the actions the Buttons run, and registers the hooks).
//
// The pane holds the cards, the pinned ones first and each group in the order they were added: a
// title, a dim line with the id and the time of the last write, and the body as Markdown (handed
// over as written, except that a mermaid fence mermaid.js can draw is an Svg). The cards have no
// buttons: the person reads, Claude writes. With none, a note says so.
//
// Around the cards, the hand-over of an earlier session's board:
//   - a board that was taken over (sealed) says it is read-only above its cards, with a button
//     that makes it writable again;
//   - the line about the last hand-over, and where the cards came from;
//   - while the board is empty and other sessions' boards are there, the frame "前のセッション
//     から引き継ぐ": one board opened, several as closed rows ([中身を見る] opens one); [引き継ぐ]
//     copies its cards in, after a confirmation when the board already has cards;
//   - with cards: a dim line with [表示] that opens the same frame.
// Last, a line when the store is over half full.
//
// The band is one short line, the card count (and a hint: boards to take over, or read-only) with
// a button that opens the pane, drawn at 0 cards too.
//
// Nothing here calls $.ui.invalidate or draws on a timer (in the desktop app every redraw
// rebuilds every mod's drawing, other mods' open panes included).

import { LIMITS, fitBand, orderedCards } from './board.js'
import { mermaidSvg, splitFences } from './mermaid.js'
import { getConfig, settingsLine, stampOf, dayStampOf, cardStampOf, storeWarning, originText } from './boards.js'

export const PANE_ID = 'whiteboard'
export const TITLE = 'ボード'

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

function drawCard(ui, card, view) {
  const { Box, Text } = ui
  const children = [
    Box({
      key: keyOf('head', card.id),
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 2,
      children: [
        Text({ bold: true, wrap: 'wrap', children: [card.title] }),
        ...(card.pinned === true ? [Text({ dimColor: true, children: ['固定'] })] : []),
        Text({ dimColor: true, children: [`${card.id} · ${cardStampOf(card.updatedAt, view.now)}`] }),
      ],
    }),
  ]
  if (card.body.trim() !== '') children.push(drawBody(ui, card, view))
  return Box({ key: keyOf('card', card.id), flexDirection: 'column', width: '100%', borderStyle: 'round', borderDimColor: true, paddingX: 1, children })
}

// The cards' blocks: a note and a box each, or what to ask for while there are none
function drawCards(ui, cards, view) {
  const { Box, Text } = ui
  if (cards.length === 0) {
    return [
      Box({ key: 'empty', flexDirection: 'column', children: [
        Text({ wrap: 'wrap', children: ['まだ何も書かれていません'] }),
        Text({ dimColor: true, wrap: 'wrap', children: ['Claude に「ボードに手順を書いて」のように頼むと、ここにカードとして残ります'] }),
      ] }),
    ]
  }
  return [
    Box({ key: 'about', children: [Text({ dimColor: true, wrap: 'wrap', children: [`${cards.length} 件 · 書き換えは Claude に頼んでください`] })] }),
    ...orderedCards(cards).map((card) => drawCard(ui, card, view)),
  ]
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
        children: [`このボードは ${stampOf(sealed.at)} に、別のセッション（${sealed.toCwdName} · ID ${sealed.toSid8}）へ引き継ぎました。ここでは読むだけで、Claude も書き込めません。`],
      }),
      Box({ key: 'sealed-buttons', flexDirection: 'row', children: [Button({ key: 'unseal', label: 'このセッションで書けるように戻す', variant: 'secondary', onPress: () => actions.unseal() })] }),
      Text({ dimColor: true, wrap: 'wrap', children: ['戻しても、引き継ぎ先のカードはそのまま残ります。'] }),
    ]),
  )
}

// The line about the last hand-over (until the pane is opened again)
function drawLast(ui, last) {
  const { Box, Text } = ui
  return Box(boxed('handover-last', [Text({ wrap: 'wrap', children: [last.text] })]))
}

// Where the cards on this board came from, for as long as the board keeps the record
function drawFrom(ui, from, now) {
  const { Box, Text } = ui
  const when = typeof from.updatedAt === 'number' ? dayStampOf(from.updatedAt, now) : '時刻不明'
  return Box({
    key: 'handover-from',
    children: [Text({ dimColor: true, wrap: 'wrap', children: [`引き継ぎ元: ${when} · ${from.cwdName} · ID ${from.sid8}（元のボードは、そのセッションを開くと読めます）`] })],
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
                ? '今のボードのカードの後ろに足します。入る枚数は、押したあとの確認で分かります。'
                : `このボードに ${b.count} 枚が入ります${b.pinnedCount > 0 ? `（固定の ${b.pinnedCount} 枚も固定のまま）` : ''}。`,
            ],
          }),
          Text({ dimColor: true, wrap: 'wrap', children: ['元のボードは読み取り専用になり、この一覧から消えます。'] }),
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
  const { added, duplicates, overflow } = confirm.plan
  const entries = (list, key) => Box({ key, flexDirection: 'column', children: list.map((c) => Text({ wrap: 'wrap', children: [`  ・${c.title}（${c.id}）`] })) })
  const pinned = added.filter((c) => c.pinned).length
  const children = [Text({ bold: true, children: ['引き継ぐ前に確認してください'] })]
  if (confirm.recounted) children.push(Text({ wrap: 'wrap', children: ['ボードが変わったので、数え直しました'] }))
  children.push(Text({ wrap: 'wrap', children: [`${originText(b, now)} · ${b.count} 枚 · ID ${b.sid8} から`] }))
  if (added.length > 0) {
    children.push(Text({ wrap: 'wrap', children: [`入る: ${added.length} 枚`] }))
    if (pinned > 0) children.push(Text({ dimColor: true, wrap: 'wrap', children: [`固定の ${pinned} 枚も固定のまま入ります`] }))
  }
  if (duplicates.length > 0) {
    children.push(Text({ wrap: 'wrap', children: [`飛ばす: ${duplicates.length} 枚（今のボードに同じ id のカードがあるため。今のカードはそのまま）`] }), entries(duplicates, 'confirm-skipped'))
  }
  if (overflow.length > 0) {
    children.push(Text({ wrap: 'wrap', children: [`入らない: ${overflow.length} 枚（カードは ${LIMITS.cards} 枚まで）`] }), entries(overflow, 'confirm-overflow'))
    children.push(Text({ dimColor: true, wrap: 'wrap', children: ['入らなかったカードは元のボードに残り、そのセッションを開けば読めます。'] }))
  }
  const buttons = []
  if (added.length > 0) {
    buttons.push(Button({ key: 'take-confirm', label: 'この内容で引き継ぐ', variant: 'secondary', onPress: () => actions.takeConfirm() }))
  } else {
    // Nothing would go in: say why, and leave only the way out
    const why =
      overflow.length > 0
        ? `今のボードは ${LIMITS.cards} 枚でいっぱいなので、1 枚も入りません。済んだカードを消してから引き継いでください`
        : '入るカードが 1 枚もありません（すべて今のボードと同じ id です）'
    children.push(Text({ wrap: 'wrap', children: [why] }))
  }
  buttons.push(Button({ key: 'take-cancel', label: 'やめる', variant: 'secondary', onPress: () => actions.takeCancel() }))
  children.push(Box({ key: 'confirm-buttons', flexDirection: 'row', columnGap: 1, children: buttons }))
  return Box(boxed('confirm', children))
}

// The frame "前のセッションから引き継ぐ": the boards that may be taken over
function drawHandover(ui, others, hasCards, view, now, actions) {
  const { Box, Text } = ui
  const single = others.boards.length === 1
  const rows = others.boards.flatMap((b) => {
    const row = drawBoardRow(ui, b, { open: single || view.pick === b.sid8, single, hasCards, now }, actions)
    return view.confirm !== null && view.confirm.sid8 === b.sid8 ? [row, drawConfirm(ui, b, view.confirm, now, actions)] : [row]
  })
  return Box(
    boxed('handover', [
      Text({ bold: true, children: ['前のセッションから引き継ぐ'] }),
      Text({ dimColor: true, wrap: 'wrap', children: ['前のセッションのボードのカードを、このボードに写します。元のボードは消えずに残り、読み取り専用になります。'] }),
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
      Text({ dimColor: true, wrap: 'wrap', children: [`前のセッションのボードを引き継ぐこともできます（${others.boards.length + others.more} 件）`] }),
      Button({ key: 'show-handover', label: view.shown ? '隠す' : '表示', variant: 'secondary', onPress: () => actions.toggleShown() }),
    ],
  })
}

// The clean-up list (switched off in this version): every other board, sealed ones marked, each
// with [消す]; the options, and the line about the last action
function drawCleanup(ui, others, actions) {
  const { Box, Text, Button } = ui
  const rows = others.cleanup.map((b) =>
    Box({
      key: keyOf('clean', b.sid8),
      flexDirection: 'column',
      children: [
        Box({
          key: keyOf('clean-head', b.sid8),
          flexDirection: 'row',
          flexWrap: 'wrap',
          columnGap: 2,
          children: [
            Text({ dimColor: true, children: [typeof b.updatedAt === 'number' ? stampOf(b.updatedAt) : '時刻不明'] }),
            Text({ bold: true, wrap: 'wrap', children: [b.cwdName] }),
            Text({ dimColor: true, children: [`${b.count} 枚`] }),
            ...(b.sealed ? [Text({ dimColor: true, children: ['引き継ぎ済み'] })] : []),
          ],
        }),
        Box({ key: keyOf('clean-buttons', b.sid8), flexDirection: 'row', children: [Button({ key: 'drop-' + b.sid8, label: '消す', variant: 'secondary', onPress: () => actions.dropBoard(b.sid8) })] }),
      ],
    }),
  )
  return Box(
    boxed('cleanup', [
      Text({ bold: true, children: ['古いボードの片付け'] }),
      Box({ key: 'cleanup-settings', children: [Text({ dimColor: true, wrap: 'wrap', children: [settingsLine(getConfig())] })] }),
      ...(others.notice !== '' ? [Box({ key: 'cleanup-notice', children: [Text({ wrap: 'wrap', children: [others.notice] })] })] : []),
      ...rows,
    ]),
  )
}

/**
 * The pane's tree. `data` is what register.js read from $.state: { cards, others, handover:
 * { sealed, from, last }, view: { pick, shown, confirm }, enabled (the setting `handover`), admin
 * (the clean-up list), now }; `where` is { surface, columns }; `actions` the Buttons' work.
 */
export function drawPane(ui, data, where, actions) {
  const { cards, others, handover, view, enabled, admin, now } = data
  const { Box, Text } = ui
  const sealed = handover.sealed !== null
  const offered = enabled && !sealed
  const warning = storeWarning(others.bytes + JSON.stringify(cards).length)
  const children = [
    ...(sealed ? [drawSealed(ui, handover.sealed, actions)] : []),
    ...(handover.last !== null ? [drawLast(ui, handover.last)] : []),
    ...(handover.from !== null ? [drawFrom(ui, handover.from, now)] : []),
    ...drawCards(ui, cards, { ...where, now }),
    ...(offered && cards.length === 0 && (others.boards.length > 0 || others.notice !== '') ? [drawHandover(ui, others, false, view, now, actions)] : []),
    ...(offered && cards.length > 0 && (others.boards.length > 0 || view.shown) ? [drawEntry(ui, others, view, actions)] : []),
    ...(offered && cards.length > 0 && view.shown ? [drawHandover(ui, others, true, view, now, actions)] : []),
    ...(warning !== '' ? [Box({ key: 'store-warning', children: [Text({ dimColor: true, wrap: 'wrap', children: [warning] })] })] : []),
    ...(admin && (others.cleanup.length > 0 || others.notice !== '') ? [drawCleanup(ui, others, actions)] : []),
  ]
  return ui.Box({ key: 'whiteboard', flexDirection: 'column', rowGap: 1, paddingX: 1, width: '100%', children })
}

/** The band's tree; `hint` is '' or the few words after the count; `onOpen` is what [開く] does. */
export function drawBand(ui, surface, columns, count, hint, onOpen) {
  const { Box, Text, Button } = ui
  const fit = fitBand({ surface, columns, count, hint })
  const children = []
  if (fit.hasLabel) children.push(Box({ key: 'board-label', flexShrink: 0, children: [Text({ children: [fit.label] })] }))
  children.push(
    Box({ key: 'board-open-slot', flexShrink: 0, children: [Button({ key: 'board-open', label: fit.buttonLabel, variant: 'secondary', onPress: onOpen })] }),
  )
  return Box({ key: 'whiteboard-band', flexDirection: 'row', flexWrap: 'nowrap', columnGap: 1, alignItems: 'center', children })
}
