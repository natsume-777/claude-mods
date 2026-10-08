// What the pane and the band draw (pure: no $ here; register.js reads the state, hands the values
// over with the actions the Buttons run, and registers the hooks).
//
// The pane starts with a section of its own, 並行処理, while any subagent is running or has just
// finished, or background work (commands, monitors, workflows, crons) is in flight as of the last
// Stop (left out otherwise): read only, kept apart from the cards. Then the cards, the pinned
// ones first and each group in the order they were added: a title, a dim line with the id and the
// time of the last write, and the body as Markdown (handed over as written, except that a mermaid
// fence mermaid.js can draw is an Svg). The cards have no buttons: the person reads, Claude
// writes. Last, while there are other sessions' boards, a list of them with [取り込む] and [消す].
// The band is one short line, the card count and the running subagents' count with a button that
// opens the pane, and is left out while there is neither a card nor a running subagent. The
// background work is not counted in it: its snapshot can be old.
//
// Nothing here calls $.ui.invalidate or draws on a timer (in the desktop app every redraw
// rebuilds every mod's drawing, other mods' open panes included).

import { fitBand, clockOf, orderedCards } from './board.js'
import { viewOf } from './agents.js'
import { rowsOf } from './background.js'
import { mermaidSvg, splitFences } from './mermaid.js'
import { getConfig, settingsLine, sizeText, stampOf } from './boards.js'

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
        Text({ dimColor: true, children: [`${card.id} · ${clockOf(card.updatedAt)}`] }),
      ],
    }),
  ]
  if (card.body.trim() !== '') children.push(drawBody(ui, card, view))
  return Box({ key: keyOf('card', card.id), flexDirection: 'column', width: '100%', borderStyle: 'round', borderDimColor: true, paddingX: 1, children })
}

// One subagent: its type, its description and its state in a row, and a finished one's summary under it
function drawAgent(ui, agent) {
  const { Box, Text } = ui
  const isRunning = agent.status === 'running'
  const dim = isRunning ? {} : { dimColor: true }
  const row = Box({
    key: keyOf('agent-row', agent.id),
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Box({ flexShrink: 0, children: [Text({ bold: true, ...dim, children: [agent.type || 'agent'] })] }),
      Box({ flexGrow: 1, flexShrink: 1, children: [Text({ wrap: 'wrap', ...dim, children: [agent.description || '（説明なし）'] })] }),
      Box({ flexShrink: 0, children: [Text(isRunning ? { color: 'success', children: ['実行中'] } : { dimColor: true, children: ['完了'] })] }),
    ],
  })
  const children = [row]
  if (!isRunning && agent.summary) {
    children.push(Box({ key: keyOf('agent-summary', agent.id), children: [Text({ dimColor: true, wrap: 'wrap', children: [agent.summary] })] }))
  }
  return Box({ key: keyOf('agent', agent.id), flexDirection: 'column', children })
}

// One piece of background work (a command, a monitor, a workflow, a cron): kind, text, state
function drawBackgroundRow(ui, row) {
  const { Box, Text } = ui
  return Box({
    key: keyOf('bg-row', row.key),
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Box({ flexShrink: 0, children: [Text({ bold: true, dimColor: !row.isRunning, children: [row.kind] })] }),
      Box({ flexGrow: 1, flexShrink: 1, children: [Text({ wrap: 'wrap', dimColor: !row.isRunning, children: [row.text || '（説明なし）'] })] }),
      Box({ flexShrink: 0, children: [Text(row.isRunning ? { color: 'success', children: [row.state] } : { dimColor: true, children: [row.state] })] }),
    ],
  })
}

// The 並行処理 section: the running subagents, then the finished ones, newest first; then, as of
// the last Stop, the background work (a snapshot: it is not kept up to date between the events)
function drawAgents(ui, view, background) {
  const { Box, Text } = ui
  const hasAgents = view.running.length + view.done.length > 0
  const children = [
    Box({
      key: 'agents-head',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 2,
      children: [
        Text({ bold: true, children: ['並行処理'] }),
        Text({ dimColor: true, children: [hasAgents ? `実行中 ${view.running.length} · 自動で更新されます` : 'バックグラウンドの作業'] }),
      ],
    }),
    ...[...view.running, ...view.done].map((agent) => drawAgent(ui, agent)),
  ]
  if (background.rows.length > 0) {
    children.push(
      Box({
        key: 'bg',
        flexDirection: 'column',
        children: [
          Box({ key: 'bg-head', children: [Text({ dimColor: true, children: [background.at === null ? 'バックグラウンド · ターン終了時点' : `バックグラウンド · ターン終了時点 ${clockOf(background.at)}`] })] }),
          ...background.rows.map((row) => drawBackgroundRow(ui, row)),
          ...(background.more > 0 ? [Box({ key: 'bg-more', children: [Text({ dimColor: true, children: [`ほか ${background.more} 件`] })] })] : []),
        ],
      }),
    )
  }
  return Box({ key: 'agents', flexDirection: 'column', width: '100%', borderStyle: 'round', borderDimColor: true, paddingX: 1, children })
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

// The other sessions' boards: the newest few with [取り込む] and [消す], the store's size, the options.
// Left out when there is none and no line about an action to show.
function drawOthers(ui, others, ownChars, actions) {
  const { Box, Text, Button } = ui
  const rows = others.boards.map((b) => {
    const id = b.sid8
    return Box({
      key: keyOf('other', id),
      flexDirection: 'column',
      children: [
        Box({
          key: keyOf('other-head', id),
          flexDirection: 'row',
          flexWrap: 'wrap',
          columnGap: 2,
          children: [
            Text({ dimColor: true, children: [typeof b.updatedAt === 'number' ? stampOf(b.updatedAt) : '時刻不明'] }),
            Text({ bold: true, wrap: 'wrap', children: [b.cwdName] }),
            Text({ dimColor: true, children: [`${b.count} 枚`] }),
          ],
        }),
        Box({ key: keyOf('other-titles', id), children: [Text({ dimColor: true, wrap: 'wrap', children: [b.titles.length > 0 ? b.titles.join(' / ') : '（カードなし）'] })] }),
        Box({
          key: keyOf('other-buttons', id),
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Button({ key: 'import-' + id, label: '取り込む', variant: 'secondary', onPress: () => actions.importBoard(id) }),
            Button({ key: 'drop-' + id, label: '消す', variant: 'secondary', onPress: () => actions.dropBoard(id) }),
          ],
        }),
      ],
    })
  })
  return Box({
    key: 'others',
    flexDirection: 'column',
    rowGap: 1,
    width: '100%',
    borderStyle: 'round',
    borderDimColor: true,
    paddingX: 1,
    children: [
      Box({
        key: 'others-head',
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 2,
        children: [Text({ bold: true, children: ['ほかのセッションのボード'] }), Text({ dimColor: true, children: [sizeText(others.bytes + ownChars)] })],
      }),
      Box({ key: 'others-settings', children: [Text({ dimColor: true, wrap: 'wrap', children: [settingsLine(getConfig())] })] }),
      ...(others.notice !== '' ? [Box({ key: 'others-notice', children: [Text({ wrap: 'wrap', children: [others.notice] })] })] : []),
      ...rows,
      ...(others.more > 0 ? [Box({ key: 'others-more', children: [Text({ dimColor: true, children: [`ほか ${others.more} 件`] })] })] : []),
    ],
  })
}

/**
 * The pane's tree. `data` is { cards, agents, snapshot, others } as register.js read them from
 * $.state; `view` is { surface, columns }; `actions` the Buttons' work (importBoard, dropBoard).
 */
export function drawPane(ui, data, view, actions) {
  const subagents = viewOf(data.agents)
  const background = rowsOf(data.snapshot)
  const section = subagents.running.length + subagents.done.length + background.rows.length > 0 ? [drawAgents(ui, subagents, background)] : []
  const hasOthers = data.others.boards.length > 0 || data.others.notice !== ''
  return ui.Box({
    key: 'whiteboard',
    flexDirection: 'column',
    rowGap: 1,
    paddingX: 1,
    width: '100%',
    children: [...section, ...drawCards(ui, data.cards, view), ...(hasOthers ? [drawOthers(ui, data.others, JSON.stringify(data.cards).length, actions)] : [])],
  })
}

/** The band's tree; `onOpen` is what [開く] does. */
export function drawBand(ui, surface, columns, count, running, onOpen) {
  const { Box, Text, Button } = ui
  const fit = fitBand({ surface, columns, count, running })
  const children = []
  if (fit.hasLabel) children.push(Box({ key: 'board-label', flexShrink: 0, children: [Text({ children: [fit.label] })] }))
  children.push(
    Box({ key: 'board-open-slot', flexShrink: 0, children: [Button({ key: 'board-open', label: fit.buttonLabel, variant: 'secondary', onPress: onOpen })] }),
  )
  return Box({ key: 'whiteboard-band', flexDirection: 'row', flexWrap: 'nowrap', columnGap: 1, alignItems: 'center', children })
}
