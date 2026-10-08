// A whiteboard Claude writes to: titled Markdown cards (steps, running jobs, links) that stay put instead of scrolling away in the chat
//
// register.js  every hook and every $ call: the four tools Claude calls (set_card, remove_card,
//              clear, list_cards), the cards' load and save, the other sessions' boards (the list,
//              [取り込む], [消す], the clean-up at the start), the subagents' start and stop, the
//              background work, the pane and the band, /whiteboard
// board.js     the limits, what each tool does to the cards and answers, the band's fit (pure)
// boards.js    the other sessions' boards: the meta, the list, the import, the archive file (pure)
// shelf.js     the store's keys turned into that list (pure)
// store.js     the queue (pure)
// agents.js    the list of subagents the pane shows above the cards (pure)
// background.js the background work shown with them: the snapshot and its rows (pure)
// mermaid.js   the mermaid fences drawn as pictures (pure)
// pane.js      what the pane and the band draw (pure)
// press-guard.js  runs a pane press again that did not reach its Button (pure)
//
// The cards live in $.state for the drawings to read (a write redraws them) and in $.store,
// keyed by the session id (`board:<id>`, with `meta:<id>` beside it: when and in which folder it
// was written), so they outlive the app: the same session opened again has them, and another
// session's pane lists them to take over or delete. The store is written first; a write it
// refuses (a store over its size limit) leaves the board as it was and the tool answers an error.
//
// The subagents live in $.state alone, for the session only: they are not cards, no tool reads
// or writes them, and nothing of them goes to the store. SubagentStart and SubagentStop write
// them, and only when the list changes. The background work (commands, monitors, workflows,
// crons) is the snapshot the last Stop or SubagentStop carried, also in $.state alone.
//
// The engine follows $ into the functions of the file it is in and no further, so everything
// that takes $ is here.

import { LIMITS, storeKey, sanitizeCards, applySet, applyRemove, applyClear, applyList } from './board.js'
import { AGENT_LIMITS, firstLine, infoOf, isShown, summaryOfMessages, attachSummary, withoutUnnamed, prune, startAgent, stopAgent, reconcile, isSame } from './agents.js'
import { replaceSnapshot, snapshotOf } from './background.js'
import { setConfig, getConfig, metaKey, metaValue, cwdNameOf, importCards, importText, archiveName, archivePath, archiveMarkdown, isStale } from './boards.js'
import { NO_OTHERS, GONE, OLD_LIST, isMine, scanEntries, othersOf, droppedText, keptText } from './shelf.js'
import { makeQueue } from './store.js'
import { PANE_ID, TITLE, widthOf, drawPane, drawBand } from './pane.js'
import { runningOf } from './agents.js'
import { GRACE_MS, guardDrawing, beginPress, hasStarted, takeOver, endPress } from './press-guard.js'

// The state this file writes (declared in types/index.d.ts)
const AGENTS = { plugin: 'whiteboard', key: 'agents' }
const CARDS = { plugin: 'whiteboard', key: 'cards' }
const BACKGROUND = { plugin: 'whiteboard', key: 'background' }
const OTHERS = { plugin: 'whiteboard', key: 'others' }

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
    description:
      'ボードのカードを読む。引数なしは全カードの id・title・body を全文で返すので重い。' +
      'まず titles_only: true（目次: id・title・本文の文字数）か query（検索）で探し、必要なカードだけ id で読む。' +
      '利用者が「ボードの手順 3 は？」のようにボードの内容を尋ねたときも、この順で探す。' +
      '会話の圧縮のあとなどに、何を書いたか思い出すためにも使う。固定したカードが先に並び、固定のカードには pinned: true が付く。' +
      'id が最優先で、あれば他は無視する（そのカード 1 枚の id・title・body）。' +
      'query は空白で分けた語をすべて含むカードを返す（id・title・body のどれか、大文字小文字は区別せず、日本語は部分一致）。各カードに、一致した行の番号（本文の 1 始まり。title か id だけの一致は 0）と、その行の先頭 120 文字を最大 5 件付ける。titles_only も一緒にあれば、その一致の行は付けず title だけにする。',
    inputSchema: {
      type: 'object',
      properties: {
        titles_only: { type: 'boolean', description: 'true で各カードの id・title・chars（本文の文字数）だけを返す。目次として軽く読む' },
        id: { type: 'string', description: 'このカード 1 枚の id・title・body だけを返す' },
        query: { type: 'string', description: '検索語。空白で分けた語をすべて含むカードを返す（大文字小文字は区別しない、日本語は部分一致）' },
      },
    },
    apply: (cards, e) => applyList(cards, e),
  },
}

// The cards have a queue (the tools, an import, the start's load); the subagents, the background
// work and the other sessions' list have queues of their own, so a tool never waits on one
const exclusive = makeQueue()
const exclusiveAgents = makeQueue()
const exclusiveBackground = makeQueue()
const exclusiveOthers = makeQueue()

// The cards of this session: $.state when it holds them (kept over a hot reload), else the store's
async function loadCards($) {
  const { value } = await $.state.get(CARDS)
  if (Array.isArray(value)) return value
  const cards = sanitizeCards(await $.store.get(storeKey(await $.session.id())))
  await $.state.set(CARDS, cards)
  return cards
}

// Writes the cards to the store and then to $.state; the drawings read the state. The meta goes
// with them (and is deleted with an empty board's key); a meta the store refuses is let go,
// since the list copes with a board that has none.
async function saveCards($, cards) {
  const id = await $.session.id()
  const key = storeKey(id)
  if (cards.length === 0) {
    await $.store.delete(key)
    try {
      await $.store.delete(metaKey(id))
    } catch {}
  } else {
    await $.store.set(key, cards)
    try {
      await $.store.set(metaKey(id), metaValue(cards, cwdNameOf(await $.session.cwd()), await $.clock.now()))
    } catch {}
  }
  await $.state.set(CARDS, cards)
}

// ---- The other sessions' boards

const messageOf = (error) => String(error?.message ?? error)

// Every other session's board in the store: { entries, bytes }
async function scanStore($) {
  const keys = await $.store.keys()
  const values = new Map()
  for (const key of keys) if (isMine(key)) values.set(key, await $.store.get(key))
  return scanEntries(await $.session.id(), keys, values)
}

// Reads the other boards from the store into $.state (`others`), with `notice` as the line the
// list shows above itself ('' for none); written only if it differs from what is there
function refreshOthers($, notice) {
  return exclusiveOthers(async () => {
    const next = othersOf(await scanStore($), notice)
    const { value } = await $.state.get(OTHERS)
    if (!isSame(value, next)) await $.state.set(OTHERS, next)
  })
}

// The other boards as the state holds them
async function readOthers($) {
  const { value } = await $.state.get(OTHERS)
  return value != null && typeof value === 'object' && Array.isArray(value.boards) ? value : NO_OTHERS
}

// The board of the short id a button carries, as the list holds it
async function listed($, sid8) {
  return (await readOthers($)).boards.find((b) => b.sid8 === sid8)
}

// A board's file when archiveDir is set: { shown: the file's name } once written, { shown: '' }
// when no folder is set, { shown, error } when it could not be written
async function archive($, { sid, updatedAt, cwdName, cards }) {
  const dir = getConfig().archiveDir
  if (dir === '') return { shown: '' }
  const name = archiveName(sid, updatedAt)
  try {
    await $.fs.write(archivePath(dir, await $.session.root(), name), archiveMarkdown({ sid, updatedAt, cwdName, cards }))
    return { shown: name }
  } catch (error) {
    return { shown: name, error: messageOf(error) }
  }
}

// Deletes a board's two keys, after its file when archiveDir is set; nothing is deleted if the
// file could not be written
async function removeBoard($, row, stored) {
  const written = await archive($, { sid: row.sid, updatedAt: row.updatedAt, cwdName: row.cwdName, cards: sanitizeCards(stored) })
  if (written.error !== undefined) return written
  await $.store.delete(storeKey(row.sid))
  try {
    await $.store.delete(metaKey(row.sid))
  } catch {}
  return written
}

// [取り込む]: copies the cards of another session's board into this one; the source stays
async function importBoard($, sid8) {
  let notice
  try {
    const row = await listed($, sid8)
    if (!row || row.sid === (await $.session.id())) notice = OLD_LIST
    else {
      const stored = await $.store.get(storeKey(row.sid))
      if (stored === undefined) notice = GONE
      else {
        notice = await exclusive(async () => {
          const result = importCards(await loadCards($), sanitizeCards(stored), LIMITS.cards)
          if (result.added > 0) await saveCards($, result.cards)
          return importText(result)
        })
      }
    }
  } catch (error) {
    notice = `取り込めませんでした: ${messageOf(error)}`
  }
  await refreshOthers($, notice).catch(() => {})
}

// [消す]: deletes another session's board, writing its file first when archiveDir is set
async function dropBoard($, sid8) {
  let notice
  try {
    const row = await listed($, sid8)
    if (!row || row.sid === (await $.session.id())) notice = OLD_LIST
    else {
      const stored = await $.store.get(storeKey(row.sid))
      if (stored === undefined) notice = GONE
      else {
        const done = await removeBoard($, row, stored)
        notice = done.error !== undefined ? keptText(done.shown, done.error) : droppedText(row, done.shown)
      }
    }
  } catch (error) {
    notice = `消せませんでした: ${messageOf(error)}`
  }
  await refreshOthers($, notice).catch(() => {})
}

// At the session's start, with autoCleanDays set: the other sessions' boards last written more
// than that many days ago are deleted, their files written first when archiveDir is set (one that
// cannot be written stays). This session's board is never touched, nor one whose time is unknown.
// A failure is a line in the debug log.
async function autoClean($) {
  const days = getConfig().autoCleanDays
  if (days < 1) return
  const now = await $.clock.now()
  const { entries } = await scanStore($)
  for (const row of entries) {
    if (!isStale(row.updatedAt, now, days)) continue
    try {
      const stored = await $.store.get(storeKey(row.sid))
      if (stored === undefined) continue
      const done = await removeBoard($, row, stored)
      if (done.error !== undefined) $.ui.log(`whiteboard: 古いボード ${row.sid8} を書き出せなかったので消していません: ${done.error}`, { to: 'debug' })
    } catch (error) {
      $.ui.log(`whiteboard: 古いボード ${row.sid8} を消せませんでした: ${messageOf(error)}`, { to: 'debug' })
    }
  }
}

// ---- What the drawings read

async function cardsOf($) {
  const { value } = await $.state.get(CARDS)
  return Array.isArray(value) ? value : []
}

async function agentsOf($) {
  const { value } = await $.state.get(AGENTS)
  return Array.isArray(value) ? value : []
}

async function backgroundOf($) {
  const { value } = await $.state.get(BACKGROUND)
  return snapshotOf(value)
}

// Opens the pane: /whiteboard and the band's button. The other sessions' boards are read again
// first (and the line about the last action is let go), so the list is as the store has it now.
async function openPane($) {
  try {
    await refreshOthers($, '')
  } catch {}
  return $.ui.open({ id: PANE_ID, title: TITLE })
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

export function register(on, options) {
  setConfig(options)

  // Fires on the session's start, and again after a hot reload
  on('session.start', async ($, e, next) => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      await $.tool.register({ name, description: tool.description, inputSchema: tool.inputSchema })
    }
    await $.command.register({ name: 'whiteboard', description: 'ボードを開く' })
    try {
      await exclusive(() => loadCards($))
    } catch {}
    // Old boards of other sessions (autoCleanDays), then the list of those that are left
    try {
      await autoClean($)
    } catch (error) {
      $.ui.log(`whiteboard: 古いボードの掃除に失敗しました: ${String(error?.message ?? error)}`, { to: 'debug' })
    }
    try {
      await refreshOthers($, '')
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

  // /whiteboard opens the pane (a helper: the band's button is the way in)
  on('command.run', { command: 'whiteboard' }, async ($) => {
    const opened = await openPane($)
    return { text: opened?.isPlaced === false ? 'ボードを開きました（まだ表示されていません）' : 'ボードを開きました' }
  })

  on('ui.render', { component: 'Pane', requestId: 'whiteboard' }, async ($, e) => {
    // The Buttons' presses are guarded (press-guard.js): the first press on an unfocused pane can be lost
    const guard = guardDrawing(e.requestId)
    const ui = guard.wrap($.ui.resolve(e))
    const data = { cards: await cardsOf($), agents: await agentsOf($), snapshot: await backgroundOf($), others: await readOthers($) }
    const actions = { importBoard: (id) => importBoard($, id), dropBoard: (id) => dropBoard($, id) }
    return guard.done(drawPane(ui, data, { surface: e.surface, columns: widthOf(e) }, actions))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const cards = await cardsOf($)
    const running = runningOf(await agentsOf($))
    if (cards.length === 0 && running === 0) return rest
    const ui = $.ui.resolve(e)
    const mine = drawBand(ui, e.surface, widthOf(e), cards.length, running, () => openPane($))
    if (!rest) return mine
    return ui.Box({ flexDirection: 'column', children: [mine, rest] })
  })

  // A press on this mod's elements (the pane and the band). On the pane (press-guard.js) it also
  // checks that the press reached the Button's onPress; when the chain settled, threw, or stayed
  // silent for GRACE_MS without it, the press runs once with the latest drawing's closure under
  // the same key.
  on('ui.press', { plugin: 'whiteboard' }, async ($, e, next) => {
    const record = beginPress(e)
    const chain = next(e).then(
      (value) => ({ kind: 'value', value }),
      (error) => ({ kind: 'error', error }),
    )
    let outcome
    if (record) {
      const timer = new AbortController()
      const grace = $.clock.sleep(GRACE_MS, { signal: timer.signal }).then(
        () => ({ kind: 'grace' }),
        () => new Promise(() => {}),
      )
      outcome = await Promise.race([chain, grace])
      timer.abort()
      if (outcome.kind === 'grace' && hasStarted(record)) outcome = await chain
    } else {
      outcome = await chain
    }
    if (!record || hasStarted(record)) {
      if (record) endPress(e, record)
      if (outcome.kind === 'error') throw outcome.error
      return outcome.value
    }
    try {
      await takeOver(record, e)
    } catch {}
    return { element: e.element }
  })
}
