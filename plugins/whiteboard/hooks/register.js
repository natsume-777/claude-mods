// A whiteboard Claude writes to: titled Markdown cards (steps, running jobs, links) that stay put instead of scrolling away in the chat
//
// register.js  the four tools Claude calls (set_card, remove_card, clear, list_cards), the
//              cards' load and save, /whiteboard's registration
// board.js     the limits, what each tool does to the cards and answers, the band's fit (pure)
// pane.js      the pane, /whiteboard, and the band above the prompt
//
// The cards live in $.state for the drawings to read (a write redraws them) and in $.store,
// keyed by the session id, so they outlive the app: the same session opened again has them,
// another session does not see them. The store is written first; a write it refuses (a store
// over its size limit) leaves the board as it was and the tool answers an error.

import { LIMITS, storeKey, sanitizeCards, applySet, applyRemove, applyClear, applyList } from './board.js'
import { registerPane } from './pane.js'

// The state this file writes (declared in types/index.d.ts)
const CARDS = { plugin: 'whiteboard', key: 'cards' }

const TOOLS = {
  set_card: {
    description:
      'ボード（人が画面の右のパネルで見る作業メモ）に、カードを追加するか上書きする。会話のログに埋もれて流れてしまう情報を残すために使う: ' +
      '進行中の手順やチェックリスト、並行して動かしている処理の状況、このセッションに関わる URL、決めたこと。' +
      '同じ id のカードは上書きされ（位置は変わらない）、状況が変わったら同じ id で更新する。1 カード 1 話題にして、本文は要点だけにする。' +
      '用が済んだカードは remove_card で消す。会話にもう書いたことを、ただ写すためには使わない。' +
      'body は Markdown（```mermaid のコードブロックも書いてよい）。' +
      `上限: ${LIMITS.cards} 枚、title ${LIMITS.title} 文字、body ${LIMITS.body} 文字、id は英数字と _ - の ${LIMITS.id} 文字まで。` +
      '会話の圧縮などで内容を思い出せないときは list_cards で読み返す。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: `カードの名前。短い英数字と _ -（例: plan, urls, jobs）。${LIMITS.id} 文字まで` },
        title: { type: 'string', description: `カードの見出し。${LIMITS.title} 文字まで` },
        body: { type: 'string', description: `本文（Markdown）。${LIMITS.body} 文字まで。空でもよい` },
      },
      required: ['id', 'title', 'body'],
    },
    apply: (cards, e, now) => applySet(cards, e, now),
  },
  remove_card: {
    description: 'ボードのカードを id で消す。済んだ手順、終わった処理、古くなった URL のカードは、残さず消す。id が無ければ、その旨を返す。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '消すカードの id' } }, required: ['id'] },
    apply: (cards, e) => applyRemove(cards, e),
  },
  clear: {
    description: 'ボードのカードを全部消す。人から「ボードを空にして」と頼まれたときや、作業が丸ごと終わったときに使う。1 枚だけ消すなら remove_card。',
    inputSchema: { type: 'object', properties: {} },
    apply: (cards) => applyClear(cards),
  },
  list_cards: {
    description: 'ボードにあるカードの id・title・body を全部返す。会話の圧縮のあとなどに、何を書いたか思い出すために使う。',
    inputSchema: { type: 'object', properties: {} },
    apply: (cards) => applyList(cards),
  },
}

// The calls run one at a time, so a read-change-write of the cards never overlaps another's
let queue = Promise.resolve()
function exclusive(fn) {
  const run = queue.then(fn)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// The cards of this session: $.state when it holds them (kept over a hot reload), else the store's
async function loadCards($) {
  const { value } = await $.state.get(CARDS)
  if (Array.isArray(value)) return value
  const cards = sanitizeCards(await $.store.get(storeKey(await $.session.id())))
  await $.state.set(CARDS, cards)
  return cards
}

// Writes the cards to the store and then to $.state; the drawings read the state
async function saveCards($, cards) {
  const key = storeKey(await $.session.id())
  if (cards.length === 0) await $.store.delete(key)
  else await $.store.set(key, cards)
  await $.state.set(CARDS, cards)
}

async function runTool($, tool, e) {
  try {
    const outcome = await exclusive(async () => {
      const before = await loadCards($)
      const change = tool.apply(before, e, await $.clock.now())
      if (!change.error && change.cards !== before) await saveCards($, change.cards)
      return change
    })
    return outcome.error ? { deny: outcome.error } : { result: outcome.text }
  } catch (error) {
    return { deny: `ボードを保存できませんでした: ${String(error?.message ?? error)}` }
  }
}

export function register(on) {
  // Fires on the session's start, and again after a hot reload
  on('session.start', async ($, e, next) => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      await $.tool.register({ name, description: tool.description, inputSchema: tool.inputSchema })
    }
    await $.command.register({ name: 'whiteboard', description: 'ボードを開く' })
    try {
      await exclusive(() => loadCards($))
    } catch {}
    return next(e)
  })

  // One hook per tool, the matcher written out so that validate can list it
  on('tool.call', { tool: 'mcp__whiteboard__set_card' }, ($, e) => runTool($, TOOLS.set_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__remove_card' }, ($, e) => runTool($, TOOLS.remove_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__clear' }, ($, e) => runTool($, TOOLS.clear, e))
  on('tool.call', { tool: 'mcp__whiteboard__list_cards' }, ($, e) => runTool($, TOOLS.list_cards, e))

  // The pane, /whiteboard and the band
  registerPane(on)
}
