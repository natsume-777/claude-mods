// A whiteboard Claude writes to: titled Markdown cards (steps, running jobs, links) that stay put instead of scrolling away in the chat
//
// register.js  the four tools Claude calls (set_card, remove_card, clear, list_cards), the
//              cards' load and save, the subagents' start and stop, /whiteboard's registration
// board.js     the limits, what each tool does to the cards and answers, the band's fit (pure)
// agents.js    the list of subagents the pane shows above the cards (pure)
// background.js the background work shown with them: the snapshot and its rows (pure)
// pane.js      the pane, /whiteboard, and the band above the prompt
//
// The cards live in $.state for the drawings to read (a write redraws them) and in $.store,
// keyed by the session id, so they outlive the app: the same session opened again has them,
// another session does not see them. The store is written first; a write it refuses (a store
// over its size limit) leaves the board as it was and the tool answers an error.
//
// The subagents live in $.state alone, for the session only: they are not cards, no tool reads
// or writes them, and nothing of them goes to the store. SubagentStart and SubagentStop write
// them, and only when the list changes. The background work (commands, monitors, workflows,
// crons) is the snapshot the last Stop or SubagentStop carried, also in $.state alone.

import { LIMITS, storeKey, sanitizeCards, applySet, applyRemove, applyClear, applyList } from './board.js'
import { AGENT_LIMITS, firstLine, infoOf, isShown, summaryOfMessages, attachSummary, withoutUnnamed, prune, startAgent, stopAgent, reconcile, isSame } from './agents.js'
import { replaceSnapshot, snapshotOf } from './background.js'
import { registerPane } from './pane.js'

// The state this file writes (declared in types/index.d.ts)
const CARDS = { plugin: 'whiteboard', key: 'cards' }
const AGENTS = { plugin: 'whiteboard', key: 'agents' }
const BACKGROUND = { plugin: 'whiteboard', key: 'background' }

const TOOLS = {
  set_card: {
    description:
      'ボード（人が画面の右のパネルで見る作業メモ）に、カードを追加するか上書きする。会話のログに埋もれて流れてしまう情報を残すために使う: ' +
      '進行中の手順やチェックリスト、並行して動かしている処理の状況、このセッションに関わる URL、決めたこと。' +
      '同じ id のカードは上書きされ（位置は変わらない）、状況が変わったら同じ id で更新する。1 カード 1 話題にして、本文は要点だけにする。' +
      '用が済んだカードは remove_card で消す。会話にもう書いたことを、ただ写すためには使わない。' +
      'body は Markdown。```mermaid の基本的な flowchart / graph（と、参加者と矢印だけの sequenceDiagram）は図になる。それ以外の図（mermaid の別の種類、ASCII など）は、コードブロックとして読める形で表示される（描画はされない）。' +
      '関係や流れは、箇条書きや表でも伝わる。' +
      'pin: true は、人が常に見ていたいカード（今の手順の全体像、URL の一覧など）に使う。使いすぎない。固定したカードは一覧の上に並ぶ。' +
      `上限: ${LIMITS.cards} 枚、title ${LIMITS.title} 文字、body ${LIMITS.body} 文字、id は英数字と _ - の ${LIMITS.id} 文字まで。` +
      '会話の圧縮などで内容を思い出せないときは list_cards で読み返す。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: `カードの名前。短い英数字と _ -（例: plan, urls, jobs）。${LIMITS.id} 文字まで` },
        title: { type: 'string', description: `カードの見出し。${LIMITS.title} 文字まで` },
        body: { type: 'string', description: `本文（Markdown）。${LIMITS.body} 文字まで。空でもよい` },
        pin: { type: 'boolean', description: 'true で先頭に固定、false で固定を外す。省略すると今のまま（新しいカードは固定なし）' },
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

// Calls run one at a time in a queue, so a read-change-write never overlaps another's
function makeQueue() {
  let queue = Promise.resolve()
  return (fn) => {
    const run = queue.then(fn)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
const exclusive = makeQueue()
// The subagents have a queue of their own, so a tool never waits on one
const exclusiveAgents = makeQueue()
const exclusiveBackground = makeQueue()

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

// The agents of this session as $.agent.list() names them now; [] when it cannot be read
async function listAgents($) {
  try {
    const agents = await $.agent.list()
    return Array.isArray(agents) ? agents : []
  } catch {
    return []
  }
}

// Takes the background work an event carries (`background_tasks`, `session_crons`) as the
// snapshot of its kind, stamped with the time, and writes it only if it differs from the one
// held (the time included, while something is in flight)
async function noteBackground($, e) {
  if (!Array.isArray(e?.background_tasks) && !Array.isArray(e?.session_crons)) return
  const now = await $.clock.now()
  await exclusiveBackground(async () => {
    const { value } = await $.state.get(BACKGROUND)
    const before = snapshotOf(value)
    const after = replaceSnapshot(before, e, now)
    if (!isSame(before, after)) await $.state.set(BACKGROUND, after)
  })
}

// The conversation of a subagent, or [] when the session cannot read it (a deny, a failure)
async function readMessages($, agentId) {
  try {
    const found = await $.session.messages({ agentId })
    return Array.isArray(found) ? found : []
  } catch {
    return []
  }
}

// Changes the list of subagents with `change(list, known, now)` and writes it if it differs.
// `known` is $.agent.list() (the description, and the end of an agent that raised no stop);
// the agent of the event is left out of that reconcile.
async function noteAgents($, exceptId, change) {
  const known = await listAgents($)
  const now = await $.clock.now()
  await exclusiveAgents(async () => {
    const { value } = await $.state.get(AGENTS)
    const before = Array.isArray(value) ? value : []
    const after = prune(reconcile(change(before, known, now), known, now, exceptId))
    if (!isSame(before, after)) await $.state.set(AGENTS, after)
  })
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
    // The subagents $.state kept over a hot reload: those with no type are an older version's
    // leftovers (the app's own agents), dropped
    try {
      await exclusiveAgents(async () => {
        const { value } = await $.state.get(AGENTS)
        if (!Array.isArray(value)) return
        const kept = withoutUnnamed(value)
        if (kept.length !== value.length) await $.state.set(AGENTS, kept)
      })
    } catch {}
    return next(e)
  })

  // One hook per tool, the matcher written out so that validate can list it
  on('tool.call', { tool: 'mcp__whiteboard__set_card' }, ($, e) => runTool($, TOOLS.set_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__remove_card' }, ($, e) => runTool($, TOOLS.remove_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__clear' }, ($, e) => runTool($, TOOLS.clear, e))
  on('tool.call', { tool: 'mcp__whiteboard__list_cards' }, ($, e) => runTool($, TOOLS.list_cards, e))

  // A subagent starts: running. The description is $.agent.list()'s (the Agent call's own).
  // The app's own agents (empty agent_type) are left out.
  on('classic.SubagentStart', async ($, e, next) => {
    if (isShown(e)) {
      try {
        await noteAgents($, e.agent_id, (list, known, now) => startAgent(list, infoOf(e, known), now))
      } catch {}
    }
    return next(e)
  })

  // A subagent stops: done at once, then its summary is added if the record is still there. The
  // summary is a line of, in this order: the report the agent handed back in a handback tool call
  // (its input; it replaces a summary the record has), the text of its last message, the event's
  // `last_assistant_message` (these two only while the record has none). A stop can come twice,
  // the first with a remark made on the way, so the later report must be able to replace it.
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    try {
      await noteBackground($, e)
    } catch {}
    if (!isShown(e)) return result
    try {
      await noteAgents($, e.agent_id, (list, known, now) => stopAgent(list, infoOf(e, known), now))
      const found = summaryOfMessages(await readMessages($, e.agent_id))
      const text = found.text || firstLine(e.last_assistant_message, AGENT_LIMITS.summary)
      if (text !== '') await noteAgents($, e.agent_id, (list) => attachSummary(list, e.agent_id, text, found.isReport))
    } catch {}
    return result
  })

  // The turn ends: the background work in flight (commands, monitors, workflows) and the crons
  // that will wake the session. Like SubagentStop, the only event that carries them.
  on('classic.Stop', async ($, e, next) => {
    try {
      await noteBackground($, e)
    } catch {}
    return next(e)
  })

  // The pane, /whiteboard and the band
  registerPane(on)
}
