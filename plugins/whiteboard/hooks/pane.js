// The pane the board opens in, /whiteboard, and the band above the prompt.
//
// The pane lists the cards in the order they were added: a title, a dim line with the id and the
// time of the last write, and the body as Markdown (handed over as written, a ```mermaid fence
// included). It has no buttons: the person reads, Claude writes. The band is one short line, the
// card count and a button that opens the pane, and is left out while the board is empty.
//
// Both read the cards from $.state while they draw, so a write to it draws them again; nothing
// here calls $.ui.invalidate or draws on a timer (in the desktop app every redraw rebuilds every
// mod's drawing, other mods' open panes included).

import { fitBand, countLabel, clockOf } from './board.js'

// The state this file reads (declared in types/index.d.ts); null until the cards are loaded
const CARDS = { plugin: 'whiteboard', key: 'cards' }

const PANE_ID = 'whiteboard'
const TITLE = 'ボード'

// Element keys allow a plain set of characters; a card's id is checked to, but not trusted to
const keyOf = (prefix, id) => prefix + '-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_')

// The cells across a drawing: the site's own width, else what the surface measured; null when
// neither is known
function widthOf(e) {
  const n = e.props?.bodyColumns
  if (typeof n === 'number' && n > 0) return n
  const v = e.viewport?.columns
  return typeof v === 'number' && v > 0 ? v : null
}

async function cardsOf($) {
  const { value } = await $.state.get(CARDS)
  return Array.isArray(value) ? value : []
}

// Opens the pane: /whiteboard and the band's button
function openPane($) {
  return $.ui.open({ id: PANE_ID, title: TITLE })
}

function drawCard(ui, card) {
  const { Box, Text, Markdown } = ui
  const children = [
    Box({
      key: keyOf('head', card.id),
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 2,
      children: [
        Text({ bold: true, wrap: 'wrap', children: [card.title] }),
        Text({ dimColor: true, children: [`${card.id} · ${clockOf(card.updatedAt)}`] }),
      ],
    }),
  ]
  if (card.body.trim() !== '') children.push(Markdown({ key: keyOf('body', card.id), text: card.body }))
  return Box({ key: keyOf('card', card.id), flexDirection: 'column', width: '100%', borderStyle: 'round', borderDimColor: true, paddingX: 1, children })
}

function drawPane(ui, cards) {
  const { Box, Text } = ui
  const blocks =
    cards.length === 0
      ? [
          Box({ key: 'empty', flexDirection: 'column', children: [
            Text({ wrap: 'wrap', children: ['まだ何も書かれていません'] }),
            Text({ dimColor: true, wrap: 'wrap', children: ['Claude に「ボードに手順を書いて」のように頼むと、ここにカードとして残ります'] }),
          ] }),
        ]
      : [
          Box({ key: 'about', children: [Text({ dimColor: true, wrap: 'wrap', children: [`${cards.length} 件 · 書き換えは Claude に頼んでください`] })] }),
          ...cards.map((card) => drawCard(ui, card)),
        ]
  return Box({ key: 'whiteboard', flexDirection: 'column', rowGap: 1, paddingX: 1, width: '100%', children: blocks })
}

function drawBand($, ui, surface, columns, count) {
  const { Box, Text, Button } = ui
  const fit = fitBand({ surface, columns, count })
  const children = []
  if (fit.hasLabel) children.push(Box({ key: 'board-label', flexShrink: 0, children: [Text({ children: [countLabel(count)] })] }))
  children.push(
    Box({ key: 'board-open-slot', flexShrink: 0, children: [Button({ key: 'board-open', label: fit.buttonLabel, variant: 'secondary', onPress: () => openPane($) })] }),
  )
  return Box({ key: 'whiteboard-band', flexDirection: 'row', flexWrap: 'nowrap', columnGap: 1, alignItems: 'center', children })
}

export function registerPane(on) {
  // /whiteboard opens the pane (a helper: the band's button is the way in)
  on('command.run', { command: 'whiteboard' }, async ($) => {
    const opened = await openPane($)
    return { text: opened?.isPlaced === false ? 'ボードを開きました（まだ表示されていません）' : 'ボードを開きました' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    return drawPane($.ui.resolve(e), await cardsOf($))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const cards = await cardsOf($)
    if (cards.length === 0) return rest
    const ui = $.ui.resolve(e)
    const mine = drawBand($, ui, e.surface, widthOf(e), cards.length)
    if (!rest) return mine
    return ui.Box({ flexDirection: 'column', children: [mine, rest] })
  })
}
