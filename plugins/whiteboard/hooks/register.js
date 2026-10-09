// A whiteboard Claude writes to: titled Markdown cards (steps, running jobs, links) that stay put instead of scrolling away in the chat
//
// register.js  every hook and every $ call: the six tools Claude calls (set_card, edit_card, append_card, remove_card,
//              clear, list_cards), the cards' load and save, the hand-over of another session's
//              board (the list, [引き継ぐ], the seal), the pane and the band, /whiteboard
// board.js     the limits, what each tool does to the cards and answers, the band's fit (pure)
// boards.js    the meta, the other sessions' boards, the hand-over's plan and words, the archive file (pure)
// shelf.js     the store's keys turned into that list (pure)
// store.js     the queue (pure)
// mermaid.js   the mermaid fences drawn as pictures (pure)
// pane.js      what the pane and the band draw (pure)
// guide.js     the fixed text that tells a new session the board exists, and when to repeat the tool lines (pure)
// press-guard.js  runs a pane press again that did not reach its Button (pure)
//
// The cards live in $.state for the drawings to read (a write redraws them) and in $.store,
// keyed by the session id (`board:<id>`, with `meta:<id>` beside it: when and in which folder it
// was written, what the session began with), so they outlive the app: the same session opened
// again has them, and a new session's pane offers them for a hand-over. The store is written
// first; a write it refuses (a store over its size limit) leaves the board as it was and the tool
// answers an error.
//
// The rule for the cards: the store is the truth and $.state is a copy for the drawings. What is
// read to be written over (the tools, a hand-over) is read from the store, inside `exclusive`. It
// is never read from $.state: one dispatch (a tool call, a press) reads $.state as it stood at its
// first read and keeps that, so a press that read $.state and then waited its turn in `exclusive`
// would write over what a tool wrote meanwhile. For the same reason a press does not read $.state
// for the cards before it enters `exclusive`. The state's `owner` says whose cards `cards` holds
// (after /clear the process goes on under another session id), and the drawings do not take cards
// of another owner.
//
// A hand-over copies the cards of another session's board into this one, then seals the other
// board: a value under `seal:<its id>`. The cards under its `board:` key are never touched. A
// sealed board is read-only: the tools that write answer a refusal (checked against the store at
// every call; a seal that cannot be read refuses too), list_cards reads with a first line that
// says so, and the pane has a button that lifts the seal. The seal holds whether or not the
// setting `handover` is on.
//
// The engine follows $ into the functions of the file it is in and no further, so everything
// that takes $ is here.

import { LIMITS, storeKey, sanitizeCards, applySet, applyEdit, applyAppend, applyRemove, applyClear, applyList } from './board.js'
import {
  setConfig,
  getConfig,
  metaKey,
  sealKey,
  readMeta,
  readSeal,
  mergeMeta,
  cwdNameOf,
  shortId,
  promptLine,
  planHandover,
  cardsSig,
  handoverText,
  sealedDenyText,
  sealUnreadableText,
  SELF_SEALED,
  sealedListLine,
  archiveName,
  archivePath,
  archiveMarkdown,
  isStale,
} from './boards.js'
import { NO_OTHERS, GONE, OLD_LIST, ALREADY, isMine, isSame, scanEntries, othersOf, droppedText, keptText } from './shelf.js'
import { makeQueue } from './store.js'
import { guideModeOf, keywordsOf, withGuide, makeGuideTurns } from './guide.js'
import { PANE_ID, TITLE, widthOf, drawPane, drawBand } from './pane.js'
import { GRACE_MS, guardDrawing, beginPress, hasStarted, takeOver, endPress } from './press-guard.js'

// The state this file writes (declared in types/index.d.ts)
const CARDS = { plugin: 'whiteboard', key: 'cards' }
const OWNER = { plugin: 'whiteboard', key: 'owner' }
const OTHERS = { plugin: 'whiteboard', key: 'others' }
const HANDOVER = { plugin: 'whiteboard', key: 'handover' }
const VIEW = { plugin: 'whiteboard', key: 'view' }

const NO_HANDOVER = { sealed: null, from: null, last: null }
const NO_VIEW = { pick: '', shown: false, confirm: null }

// Deleting other sessions' boards ([消す]), the file written before a delete (archiveDir) and the
// automatic clean-up (autoCleanDays) are built but switched off in this version: with false none of
// them runs and the pane draws no clean-up list. To bring them back, set true and restore the
// `userConfig` entries `archiveDir` (string, default "") and `autoCleanDays` (number, default 0)
// in plugin.json.
const SHELF_ADMIN_ENABLED = false

const TOOLS = {
  set_card: {
    description:
      'ボード（人が画面の右のパネルで見る作業メモ）に、カードを追加するか上書きする。会話のログに埋もれて流れてしまう情報を残すために使う: ' +
      '進行中の手順やチェックリスト、並行して動かしている処理の状況、このセッションに関わる URL、決めたこと。' +
      '同じ id のカードは上書きされ（位置は変わらない）、状況が変わったら同じ id で更新する。1 カード 1 話題にして、本文は要点だけにする。' +
      '本文の一部だけを変えるときは、全文を書き直さず edit_card（一部の置き換え）か append_card（末尾に足す）を使う。' +
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
    writes: true,
    apply: (cards, e, now) => applySet(cards, e, now),
  },
  edit_card: {
    description:
      'ボードのカードの本文の一部だけを書き換える。「手順の 1 項目を済みにする」「リンクの 1 つを直す」のように、数行しか変えないときに使う（全文を書き直すより軽い）。' +
      'find（本文の中にある文字列。改行を含んでよい）を replace に置き換える。find は、本文の中にちょうど 1 箇所だけ一致する長さにする' +
      '（0 箇所なら見つからなかった、2 箇所以上なら曖昧だとして断られる）。同じ文字列をすべて置き換えるなら all: true。replace を空にすると find の部分を消す。' +
      'title、固定、カードの位置は変わらない。カードが無ければ set_card で作る。全体を書き直すときは set_card。' +
      `置き換えたあとの本文が ${LIMITS.body} 文字を超える場合も断られる。`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '書き換えるカードの id' },
        find: { type: 'string', description: '本文の中で置き換える文字列（空でない、改行を含んでよい）。1 箇所だけに一致する長さにする' },
        replace: { type: 'string', description: '置き換える文字列。空にすると find の部分を消す' },
        all: { type: 'boolean', description: 'true で、find に一致する箇所をすべて置き換える。省略すると、一致が 1 箇所のときだけ置き換える' },
      },
      required: ['id', 'find', 'replace'],
    },
    writes: true,
    apply: (cards, e, now) => applyEdit(cards, e, now),
  },
  append_card: {
    description:
      'ボードのカードの本文の末尾に、文を足す。「URL を 1 つ足す」「経過を 1 行足す」のように、一部だけ変えるときに使う（全文を書き直すより軽い）。' +
      '本文が空でなければ、間に改行を 1 つ入れて、新しい行として足す。title、固定、カードの位置は変わらない。' +
      `カードが無ければ set_card で作る。全体を書き直すときは set_card。足したあとの本文が ${LIMITS.body} 文字を超える場合は断られる。`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '足すカードの id' },
        text: { type: 'string', description: '本文の末尾に足す文（Markdown）' },
      },
      required: ['id', 'text'],
    },
    writes: true,
    apply: (cards, e, now) => applyAppend(cards, e, now),
  },
  remove_card: {
    description: 'ボードのカードを id で消す。済んだ手順、終わった処理、古くなった URL のカードは、残さず消す。id が無ければ、その旨を返す。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '消すカードの id' } }, required: ['id'] },
    writes: true,
    apply: (cards, e) => applyRemove(cards, e),
  },
  clear: {
    description: 'ボードのカードを全部消す。人から「ボードを空にして」と頼まれたときや、作業が丸ごと終わったときに使う。1 枚だけ消すなら remove_card。',
    inputSchema: { type: 'object', properties: {} },
    writes: true,
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
    writes: false,
    apply: (cards, e) => applyList(cards, e),
  },
}

// The cards have a queue (the tools, a hand-over, the start's load); the other sessions' list has
// one of its own, so a tool never waits on it; the small state values (`handover`, `view`) have a third
const exclusive = makeQueue()
const exclusiveOthers = makeQueue()
const exclusiveState = makeQueue()

const messageOf = (error) => String(error?.message ?? error)
const isText = (s) => typeof s === 'string' && s !== ''

// What this load has heard of each session (by id) to write into its meta at the next save: the
// first request the person made and the latest title
const noted = new Map()

// The setting `handover` (on unless false) and what it turns on: reading the other boards
const handoverOn = () => getConfig().handover
const wantsOthers = () => handoverOn() || SHELF_ADMIN_ENABLED

// The cards of the session `id` as the store has them: the truth (see the top of this file)
async function storedCards($, id) {
  return sanitizeCards(await $.store.get(storeKey(id)))
}

// The cards of this session, from the store; $.state is brought in line when it differs (cards or
// owner), for the drawings. Call it inside `exclusive`, not from a press before it waits there.
async function loadCards($) {
  const id = await $.session.id()
  const cards = await storedCards($, id)
  if (!isSame((await $.state.get(CARDS)).value, cards)) await $.state.set(CARDS, cards)
  if ((await $.state.get(OWNER)).value !== id) await $.state.set(OWNER, id)
  return cards
}

// Writes the cards to the store and then to $.state; the drawings read the state. The meta goes
// with them, laid over the one there (and is deleted with an empty board's key, which also ends
// the record of where the cards came from); `extra` adds to the meta. A meta the store refuses is
// let go, since the list copes with a board that has none. The seal is not part of the meta and is
// never touched here.
async function saveCards($, cards, extra = {}) {
  const id = await $.session.id()
  const key = storeKey(id)
  if (cards.length === 0) {
    await $.store.delete(key)
    try {
      await $.store.delete(metaKey(id))
    } catch {}
    await patchHandover($, { from: null })
  } else {
    await $.store.set(key, cards)
    try {
      const prev = readMeta(await $.store.get(metaKey(id)))
      const note = noted.get(id)
      const patch = { updatedAt: await $.clock.now(), cwdName: cwdNameOf(await $.session.cwd()), count: cards.length, firstPrompt: note?.firstPrompt, title: note?.title, ...extra }
      await $.store.set(metaKey(id), mergeMeta(prev, patch))
    } catch {}
  }
  await $.state.set(CARDS, cards)
  await $.state.set(OWNER, id)
}

// ---- The small state values

const objectOr = (value, fallback) => (value != null && typeof value === 'object' && !Array.isArray(value) ? value : fallback)

// The hand-over's state as $.state holds it; a value of an older shape is filled with the defaults
async function readHandover($) {
  const { value } = await $.state.get(HANDOVER)
  const v = objectOr(value, {})
  return { sealed: objectOr(v.sealed, null), from: objectOr(v.from, null), last: objectOr(v.last, null) }
}

async function readView($) {
  const { value } = await $.state.get(VIEW)
  const v = objectOr(value, {})
  return { pick: typeof v.pick === 'string' ? v.pick : '', shown: v.shown === true, confirm: objectOr(v.confirm, null) }
}

// Writes a state value only when it differs from what is there (a write redraws the drawings).
// The engine wants the reference spelled out at each call, so one function for each value.
async function setHandover($, next) {
  const { value } = await $.state.get(HANDOVER)
  if (!isSame(value, next)) await $.state.set(HANDOVER, next)
}
async function setView($, next) {
  const { value } = await $.state.get(VIEW)
  if (!isSame(value, next)) await $.state.set(VIEW, next)
}
async function setOthers($, next) {
  const { value } = await $.state.get(OTHERS)
  if (!isSame(value, next)) await $.state.set(OTHERS, next)
}

// A change to one of the two small values
function patchHandover($, patch) {
  return exclusiveState(async () => setHandover($, { ...(await readHandover($)), ...patch }))
}
function patchView($, patch) {
  return exclusiveState(async () => setView($, { ...(await readView($)), ...patch }))
}

// The cards for a drawing: the state's, when it holds this session's. Cards of another owner (the
// process went on under a new session id after /clear) are not drawn: the store's are read instead
// (a drawing may read the store, but may not write the state).
async function cardsOf($) {
  const { value } = await $.state.get(CARDS)
  const id = await $.session.id()
  if (Array.isArray(value) && (await $.state.get(OWNER)).value === id) return value
  try {
    return await storedCards($, id)
  } catch {
    return []
  }
}

// The time, with the clock's own call; the system's if that fails (a drawing must not fail on it)
async function nowOf($) {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

// ---- The seal

// The seal of the board of the session `sid` (the `seal:` value, else a 0.9.0 meta's `handedOver`)
// and its meta: { sealed, meta }. It throws when the store cannot be read: no caller takes that
// for "not sealed".
async function readSealState($, sid) {
  const seal = readSeal(await $.store.get(sealKey(sid)))
  const meta = readMeta(await $.store.get(metaKey(sid)))
  return { sealed: seal ?? meta?.handedOver ?? null, meta }
}

// Takes the seal and the record of where the cards came from from this session's store into the
// state. The record is kept while the meta has none (a meta the store refused).
async function syncOwn($) {
  const { sealed, meta } = await readSealState($, await $.session.id())
  await patchHandover($, { sealed, ...(meta?.handedFrom ? { from: meta.handedFrom } : {}) })
}

// [このセッションで書けるように戻す]: lifts the seal; the other session's cards stay. In the cards'
// queue, so that no tool call is half-way through while it goes.
function unseal($) {
  return exclusive(async () => {
    let patch
    try {
      const id = await $.session.id()
      const { meta } = await readSealState($, id)
      await $.store.delete(sealKey(id))
      // A 0.9.0 seal sits in the meta
      if (meta?.handedOver) await $.store.set(metaKey(id), mergeMeta(meta, { handedOver: null }))
      patch = { sealed: null, last: { text: '書けるように戻しました。このボードは、また引き継ぎの候補に出ます' } }
    } catch (error) {
      patch = { last: { text: `書けるように戻せませんでした: ${messageOf(error)}` } }
    }
    await patchHandover($, patch)
  })
}

// ---- The other sessions' boards

// Every other session's board in the store: { entries, bytes }
async function scanStore($) {
  const keys = await $.store.keys()
  const values = new Map()
  for (const key of keys) if (isMine(key)) values.set(key, await $.store.get(key))
  return scanEntries(await $.session.id(), keys, values)
}

// Reads the other boards from the store into $.state (`others`), with `notice` as the line the
// frame shows above the list ('' for none); written only if it differs from what is there
function refreshOthers($, notice) {
  if (!wantsOthers()) return Promise.resolve()
  return exclusiveOthers(async () => {
    const options = { me: await $.session.id(), cwdName: cwdNameOf(await $.session.cwd()), notice, handover: handoverOn(), admin: SHELF_ADMIN_ENABLED }
    const next = othersOf(await scanStore($), options)
    await setOthers($, next)
  })
}

// The other boards as the state holds them (a value of an older shape is filled with the defaults)
async function readOthers($) {
  if (!wantsOthers()) return NO_OTHERS
  const { value } = await $.state.get(OTHERS)
  if (value == null || typeof value !== 'object' || !Array.isArray(value.boards)) return NO_OTHERS
  // A row of an older shape (no title list) is left out rather than drawn wrong
  return { ...NO_OTHERS, ...value, boards: value.boards.filter((b) => b != null && Array.isArray(b.allTitles)) }
}

// The board of the short id a button carries, as the lists hold it
async function listed($, sid8) {
  const others = await readOthers($)
  return others.boards.find((b) => b.sid8 === sid8) ?? others.cleanup.find((b) => b.sid8 === sid8)
}

// ---- The hand-over

// What the confirmation step keeps of a plan: the cards it names, not the cards themselves
const slim = ({ added, duplicates, overflow }) => ({ added, duplicates, overflow })

// Copies the cards of the board `row` in after this session's, then seals it (the `seal:` key of
// the source; its cards and meta are not touched). With cards on this board, a first call
// (`confirm` null) only stages the confirmation; the call that comes from [この内容で引き継ぐ]
// carries the staged `confirm` and goes on if the boards are as they were, else stages it again.
// This session's own seal and cards are read inside `exclusive`, from the store. Answers the line
// for the frame ('' when there is none).
async function handOver($, row, confirm) {
  const me = await $.session.id()
  const source = sanitizeCards(await $.store.get(storeKey(row.sid)))
  if (source.length === 0) return GONE
  const taken = (await readSealState($, row.sid)).sealed
  if (taken && taken.to !== me) return ALREADY(taken)
  const now = await $.clock.now()
  const cwdName = cwdNameOf(await $.session.cwd())
  return exclusive(async () => {
    // This board may have been sealed since the pane last looked: nothing is written to it then
    const own = (await readSealState($, me)).sealed
    if (own) {
      await patchHandover($, { sealed: own, last: { text: SELF_SEALED } })
      await patchView($, { confirm: null })
      return SELF_SEALED
    }
    const current = await storedCards($, me)
    const plan = planHandover(current, source, LIMITS.cards)
    const sig = cardsSig(current) + '|' + cardsSig(source)
    const confirmed = confirm !== null && confirm.sig === sig
    if ((current.length > 0 && !confirmed) || plan.added.length === 0) {
      // shown: the step is seen even when the board had no cards at the press and got one since
      await patchView($, { shown: true, confirm: { sid8: row.sid8, sig, plan: slim(plan), recounted: confirm !== null && !confirmed } })
      return ''
    }
    // The copy first, then the seal: a seal without a copy is never left behind
    const handedFrom = { sid: row.sid, sid8: row.sid8, cwdName: row.cwdName, updatedAt: row.updatedAt, count: row.count, at: now }
    await saveCards($, plan.cards, { handedFrom })
    let text = handoverText(plan, row, now)
    try {
      await $.store.set(sealKey(row.sid), { to: me, toSid8: shortId(me), toCwdName: cwdName, at: now })
      // Another session may have taken the same board over at the same moment
      const after = (await readSealState($, row.sid)).sealed
      if (after && after.to !== me) {
        text += `同じボードを、ほぼ同時に別のセッション（${after.toCwdName} · ID ${after.toSid8}）も引き継ぎました。どちらにも写しがあります`
      }
    } catch (error) {
      text = `カードは写しましたが、元のボードを読み取り専用にできませんでした（${messageOf(error)}）。元のボードは、この一覧に残ります`
    }
    await patchView($, NO_VIEW)
    await patchHandover($, { from: handedFrom, last: { text } })
    return ''
  })
}

// [引き継ぐ] and [この内容で引き継ぐ]: the board of `sid8` as the list holds it
async function take($, sid8, confirm) {
  let notice
  try {
    const row = await listed($, sid8)
    notice = !row || row.sid === (await $.session.id()) ? OLD_LIST : await handOver($, row, confirm)
  } catch (error) {
    notice = `引き継げませんでした: ${messageOf(error)}`
  }
  await refreshOthers($, notice).catch(() => {})
}

async function takeConfirm($) {
  const { confirm } = await readView($)
  if (confirm !== null) await take($, confirm.sid8, confirm)
}

// [中身を見る] / [閉じる]: one board is open at a time
async function peek($, sid8) {
  const view = await readView($)
  await patchView($, { pick: view.pick === sid8 ? '' : sid8, confirm: null })
}

// [表示] / [隠す] on a board that has cards
async function toggleShown($) {
  const view = await readView($)
  await patchView($, { shown: !view.shown, pick: '', confirm: null })
}

// ---- The clean-up (switched off in this version, SHELF_ADMIN_ENABLED)

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
    await $.store.delete(sealKey(row.sid))
  } catch {}
  return written
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
  if (!SHELF_ADMIN_ENABLED) return
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

// ---- What the drawings read, and the entrances

// Opens the pane: /whiteboard and the band's button. The seal and the other sessions' boards are
// read again first (and the line about the last action is let go, the pane's view starts afresh),
// so the pane is as the store has it now.
async function openPane($) {
  try {
    await syncOwn($)
  } catch {}
  try {
    await refreshOthers($, '')
  } catch {}
  try {
    await patchHandover($, { last: null })
    await patchView($, NO_VIEW)
  } catch {}
  return $.ui.open({ id: PANE_ID, title: TITLE })
}

// What a tool call does. Every call looks at the seal in the store first: a write to a sealed
// board is refused before it touches the cards, list_cards reads on and says the board is sealed.
// A seal that cannot be read is not "no seal": a write is refused then (list_cards reads on).
async function runTool($, tool, e) {
  try {
    const outcome = await exclusive(async () => {
      let sealed = null
      let isKnown = true
      try {
        sealed = (await readSealState($, await $.session.id())).sealed
      } catch (error) {
        if (tool.writes) return { error: sealUnreadableText(messageOf(error)) }
        isKnown = false
      }
      if (isKnown) await patchHandover($, { sealed })
      if (sealed && tool.writes) return { error: sealedDenyText(sealed) }
      const before = await loadCards($)
      const change = tool.apply(before, e, await $.clock.now())
      if (!change.error && change.cards !== before) await saveCards($, change.cards)
      return sealed && !change.error ? { ...change, text: sealedListLine(sealed) + '\n' + change.text } : change
    })
    return outcome.error ? { deny: outcome.error } : { result: outcome.text }
  } catch (error) {
    return { deny: `${tool.writes ? 'ボードを保存できませんでした' : 'ボードを読めませんでした'}: ${messageOf(error)}` }
  }
}

// The person's own words and the session's title, kept for the meta (the first request once).
// Nothing is kept while the setting `handover` is off: they are for the list of boards to take over.
async function noteRequest($, e) {
  if (!handoverOn()) return
  try {
    const id = await $.session.id()
    const note = noted.get(id) ?? {}
    if (isText(e.session_title)) note.title = promptLine(e.session_title)
    if ((e.source === undefined || e.source === 'user') && note.firstPrompt === undefined) {
      const line = promptLine(e.prompt)
      if (line !== '') note.firstPrompt = line
    }
    noted.set(id, note)
  } catch {}
}

export function register(on, options) {
  setConfig(options)
  noted.clear()
  const guideMode = guideModeOf(options)
  // The turns' count lives in this load only (a hot reload starts it again)
  const guideTurns = makeGuideTurns(keywordsOf(options))

  // Fires on the session's start, and again after a hot reload
  on('session.start', async ($, e, next) => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      await $.tool.register({ name, description: tool.description, inputSchema: tool.inputSchema })
    }
    await $.command.register({ name: 'whiteboard', description: 'ボードを開く' })
    try {
      await exclusive(() => loadCards($))
    } catch {}
    // The seal and the record of where the cards came from, which the store keeps
    try {
      await syncOwn($)
    } catch {}
    // Old boards of other sessions (autoCleanDays, switched off in this version)
    try {
      await autoClean($)
    } catch (error) {
      $.ui.log(`whiteboard: 古いボードの掃除に失敗しました: ${messageOf(error)}`, { to: 'debug' })
    }
    // With the board empty, the boards that may be taken over, once (the band says so); with
    // cards, they are read when the pane is opened (the clean-up list is read at the start too)
    try {
      if (SHELF_ADMIN_ENABLED || (await cardsOf($)).length === 0) await refreshOthers($, '')
    } catch {}
    return next(e)
  })

  // One hook per tool, the matcher written out so that validate can list it
  on('tool.call', { tool: 'mcp__whiteboard__set_card' }, ($, e) => runTool($, TOOLS.set_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__edit_card' }, ($, e) => runTool($, TOOLS.edit_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__append_card' }, ($, e) => runTool($, TOOLS.append_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__remove_card' }, ($, e) => runTool($, TOOLS.remove_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__clear' }, ($, e) => runTool($, TOOLS.clear, e))
  on('tool.call', { tool: 'mcp__whiteboard__list_cards' }, ($, e) => runTool($, TOOLS.list_cards, e))

  // The guide: one fixed section at the end of the system prompt, the same text on every call
  // (nothing of the cards in it), so the prompt cache is not spent. Off: nothing is added.
  on('prompt.compose', async ($, e, next) => withGuide(await next(e), e.traits, guideMode))

  // The person's first request and the session's title are kept for the meta (the list tells
  // boards apart by them). full: when the person's message holds a keyword, the lines on which
  // tool to use are handed to the model with it (additionalContext); the message itself is not
  // changed. Not more than once in a few turns. Only the person's own messages count.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteRequest($, e)
    const result = await next(e)
    if (guideMode !== 'full' || (e.source !== undefined && e.source !== 'user')) return result
    const lines = guideTurns(e.prompt)
    if (lines === '') return result
    return { ...result, additionalContext: [...(result?.additionalContext ?? []), lines] }
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
    const data = {
      cards: await cardsOf($),
      others: await readOthers($),
      handover: await readHandover($),
      view: await readView($),
      enabled: handoverOn(),
      admin: SHELF_ADMIN_ENABLED,
      now: await nowOf($),
    }
    const actions = {
      peek: (sid8) => peek($, sid8),
      take: (sid8) => take($, sid8, null),
      takeConfirm: () => takeConfirm($),
      takeCancel: () => patchView($, { confirm: null }),
      toggleShown: () => toggleShown($),
      unseal: () => unseal($),
      dropBoard: (sid8) => dropBoard($, sid8),
    }
    return guard.done(drawPane(ui, data, { surface: e.surface, columns: widthOf(e) }, actions))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const cards = await cardsOf($)
    const sealed = (await readHandover($)).sealed !== null
    const offered = !sealed && cards.length === 0 && handoverOn() && (await readOthers($)).boards.length > 0
    const hint = sealed ? '読み取り専用' : offered ? '引き継げます' : ''
    const ui = $.ui.resolve(e)
    const mine = drawBand(ui, e.surface, widthOf(e), cards.length, hint, () => openPane($))
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
