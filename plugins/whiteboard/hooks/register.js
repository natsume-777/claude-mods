// A whiteboard Claude writes to: titled Markdown cards (steps, running jobs, links) that stay put instead of scrolling away in the chat
//
// register.js  every hook and every $ call: the tool calls, the cards' load and save, the hand-over of another
//              session's board (the list, [引き継ぐ], the seal), the pane and the band, /whiteboard
// tools.js     the seven tools Claude calls (set_card, edit_card, append_card, remove_card, clear, list_cards,
//              undo_card): what each is told, its input, and what it does to the cards (pure)
// board.js     the limits, what each tool does to the cards and answers, the band's fit (pure)
// boards.js    the meta, the other sessions' boards, the hand-over's plan and words (pure)
// shelf.js     the store's keys turned into that list (pure)
// others.js    list_cards' `others`: the earlier boards of the same project, read for Claude (pure)
// view-state.js  the small state values (`handover`, `view`, `others`) read with their defaults (pure)
// store.js     the queue (pure)
// mermaid.js   the mermaid fences drawn as pictures (pure)
// pane.js      what the pane and the band draw (pure)
// style.js     a card's style: the names Claude may give, the palette and the setting `colors` (pure)
// guide.js     the fixed text that tells a new session the board exists, and when to repeat the tool lines (pure)
// recent.js    the person's turns and the cards changed in the latest one, with their line counts (pure)
// fold.js      long cards folded in the pane, and the person's fold choices (pure)
// search.js    the pane's search field: the cards narrowed by words typed, the view only (pure)
// order.js     the pane's order: as added, or the latest write first, the view only (pure)
// stale.js     the cards not written for a while (the setting `staleHours`), pointed out, never removed (pure)
// press-guard.js  runs a pane press again that did not reach its Button (pure)
//
// The cards live in $.state for the drawings to read (a write redraws them) and in $.store,
// keyed by the session id: `board:<id>` holds one record, the cards with the board's revision and
// the cards removed lately (which undo_card brings back; see board.js), written in one store
// write; `meta:<id>` beside it says when and in which folder it was written (the folder's name,
// and a hash of the session root's full path for list_cards' `others`) and what the session
// began with. So they outlive the app: the same session opened again has them, and a new session's
// pane offers them for a hand-over. The store is written first; a write it refuses (a store over
// its size limit) leaves the board as it was and the tool answers an error.
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
// every call; a seal that cannot be read refuses too), list_cards reads with a line (after the
// revision) that says so, and the pane has a button that lifts the seal. The seal holds whether or not the
// setting `handover` is on.
//
// The engine follows $ into the functions of the file it is in and never across an import (validate
// refuses $ passed to an imported function), so everything that takes $ is here; the other modules
// are pure.

import {
  LIMITS,
  maxCardsOf,
  storeKey,
  LEGACY_KEYS,
  isBoardRecord,
  boardCardsOf,
  readBoard,
  boardRecord,
  stampRevs,
  shownCards,
  trackPrev,
  removedAfter,
  compactionNote,
  isCompactionSummary,
  bandCard,
  BOARD_NAME,
} from './board.js'
import {
  setConfig,
  getConfig,
  metaKey,
  sealKey,
  readMeta,
  mergeMeta,
  cwdNameOf,
  rootHashOf,
  shortId,
  promptLine,
  planHandover,
  cardsSig,
  handoverText,
  sealedDenyText,
  sealUnreadableText,
  selfSealedText,
  sealedListLine,
  readSeal,
  isText,
} from './boards.js'
import { NO_OTHERS, goneText, OLD_LIST, ALREADY, alreadyMineText, isMine, isSame, sizeOf, scanEntries, othersOf } from './shelf.js'
import { OTHERS_OFF, othersMode, projectBoards, answerOthers } from './others.js'
import { TOOLS, toolsFor } from './tools.js'
import { NO_VIEW, handoverOf, viewOf, othersValueOf } from './view-state.js'
import { makeQueue } from './store.js'
import { guideModeOf, keywordsOf, withGuide, makeGuideTurns } from './guide.js'
import { PANE_ID, widthOf, drawPane, drawBand } from './pane.js'
import { isPersonPrompt, readTurn, turnAfter, markWrite, shownMarks, marksOf, seedMarks, markedCount } from './recent.js'
import { paletteOf, shapesOn } from './style.js'
import { foldsOf, foldsAfter, foldsKept } from './fold.js'
import { SEARCH_MIN, filterOf, filterAfter, filterCleared } from './search.js'
import { orderOf, orderAfter } from './order.js'
import { STALE_DEFAULT_HOURS, staleHoursOf, staleCount } from './stale.js'
import { GRACE_MS, guardDrawing, beginPress, hasStarted, takeOver, endPress } from './press-guard.js'

// The state this file writes (declared in types/index.d.ts)
const CARDS = { plugin: 'whiteboard', key: 'cards' }
const OWNER = { plugin: 'whiteboard', key: 'owner' }
const OTHERS = { plugin: 'whiteboard', key: 'others' }
const HANDOVER = { plugin: 'whiteboard', key: 'handover' }
const VIEW = { plugin: 'whiteboard', key: 'view' }
const TURN = { plugin: 'whiteboard', key: 'turn' }
const RECENT = { plugin: 'whiteboard', key: 'recent' }

// The cards have a queue (the tools, a hand-over, the start's load); the other sessions' list has
// one of its own, so a tool never waits on it; the small state values (`handover`, `view`) have a third
const exclusive = makeQueue()
const exclusiveOthers = makeQueue()
const exclusiveState = makeQueue()

const messageOf = (error) => String(error?.message ?? error)

// What this load has heard of each session (by id) to write into its meta at the next save: the
// first request the person made and the latest title
const noted = new Map()

// The setting `handover` (on unless false), which turns on reading the other boards
const handoverOn = () => getConfig().handover

// The board of the session `id` as the store has it, the truth (see the top of this file):
// { cards, rev, removed, legacy } (board.js readBoard). The keys an older build kept beside the
// board are read only when its value is not a record; nothing is written here.
async function storedBoard($, id) {
  const value = await $.store.get(storeKey(id))
  if (isBoardRecord(value)) return readBoard(value)
  return readBoard(value, { rev: await $.store.get(LEGACY_KEYS.rev(id)), removed: await $.store.get(LEGACY_KEYS.removed(id)) })
}

// The cards of the session `id` as the store has them
async function storedCards($, id) {
  return (await storedBoard($, id)).cards
}

// The board of this session, from the store; $.state is brought in line when it differs (cards or
// owner), for the drawings ($.state holds the cards without `prev`). Call it inside `exclusive`,
// not from a press before it waits there.
async function loadBoard($) {
  const id = await $.session.id()
  const board = await storedBoard($, id)
  const shown = shownCards(board.cards)
  if (!isSame((await $.state.get(CARDS)).value, shown)) await $.state.set(CARDS, shown)
  if ((await $.state.get(OWNER)).value !== id) await $.state.set(OWNER, id)
  return board
}

// Writes the board's record to the store (one write: the cards, the revision and the removed
// cards together) and then the cards to $.state; the drawings read the state. An emptied board
// keeps its record (board.js). The meta goes with the cards, laid over the one there; it is
// deleted when the board has no cards, which also ends the record of where the cards came from;
// `extra` adds to the meta. A meta the store refuses is let go, since the list copes with a board
// that has none. The keys an older build kept beside the board (`legacy`) are deleted once the
// record is written; one that cannot be deleted is let go, a record is never read with them. The
// seal is not part of the meta and is never touched here.
async function saveBoard($, board, legacy, extra = {}) {
  const id = await $.session.id()
  const key = storeKey(id)
  const record = boardRecord(board)
  // What is written is measured as it goes, for the pane's warning (ownSize); a meta write or
  // delete that fails leaves the size unknown, so it is read again at the next drawing
  forgetOwnSize()
  if (record === null) await $.store.delete(key)
  else await $.store.set(key, record)
  let bytes = record === null ? 0 : sizeOf(record)
  if (legacy) {
    try {
      await $.store.delete(LEGACY_KEYS.rev(id))
      await $.store.delete(LEGACY_KEYS.removed(id))
    } catch {}
  }
  if (board.cards.length === 0) {
    try {
      await $.store.delete(metaKey(id))
    } catch {
      bytes = null
    }
    await patchHandover($, { from: null })
  } else {
    try {
      const prev = readMeta(await $.store.get(metaKey(id)))
      const note = noted.get(id)
      const root = await $.session.root()
      const patch = { updatedAt: await $.clock.now(), cwdName: cwdNameOf(root), rootHash: rootHashOf(root),count: board.cards.length, firstPrompt: note?.firstPrompt, title: note?.title, ...extra }
      const meta = mergeMeta(prev, patch)
      await $.store.set(metaKey(id), meta)
      bytes += sizeOf(meta)
    } catch {
      bytes = null
    }
  }
  if (bytes !== null) {
    forgetOwnSize()
    ownBytes = { owner: id, bytes }
  }
  await $.state.set(CARDS, shownCards(board.cards))
  await $.state.set(OWNER, id)
  await pruneView($, id, board.cards)
}

// After a write: the fold choices of cards no longer on the board are let go (fold.js foldsKept),
// so a new card under a removed card's id does not take its choice; with fewer cards than bring
// the search field, its filter is let go too (search.js), so it does not come back with the field.
// A failure here never fails the write.
async function pruneView($, id, cards) {
  try {
    await exclusiveState(async () => {
      const read = await readView($)
      let view = read
      const folds = foldsKept(view.folds, id, cards.map((c) => c.id))
      if (folds !== null) view = { ...view, folds }
      if (cards.length < SEARCH_MIN) view = filterCleared(view)
      if (view !== read) await setView($, view)
    })
  } catch {}
}

// Saves a write: `after`, what a tool or a hand-over made of `board`'s cards (the board as read in
// the same turn of `exclusive`), with each card's previous version (trackPrev), the revisions
// stamped on (stampRevs) and the removed cards brought in line (removedAfter: a card gone from the
// board joins them, one back on the board leaves them). Answers the board's revision after it.
async function commitBoard($, board, after, extra = {}) {
  const stamped = stampRevs(board.cards, trackPrev(board.cards, after), board.rev)
  const { removed } = removedAfter(board.removed, board.cards, stamped.cards)
  await saveBoard($, { cards: stamped.cards, rev: stamped.rev, removed }, board.legacy, extra)
  return stamped.rev
}

// The JSON size of this session's record and meta as this load last wrote or read them, by owner
// ({ owner, bytes }), or null when it is not known: saveBoard sets it, and anything else that
// writes one of the two keys lets it go (forgetOwnSize). `ownGen` moves on at each of those, so a
// drawing that measured the store while a write went on does not keep what it measured.
let ownBytes = null
let ownGen = 0

function forgetOwnSize() {
  ownBytes = null
  ownGen++
}

// The JSON size of what this session keeps in the store (its board's record and its meta), for
// the pane's warning; null when it cannot be read. Read from the store only when not known, so a
// drawing does not read and measure the whole record each time.
async function ownSize($) {
  try {
    const id = await $.session.id()
    if (ownBytes !== null && ownBytes.owner === id) return ownBytes.bytes
    const gen = ownGen
    let n = 0
    for (const key of [storeKey(id), metaKey(id)]) n += sizeOf(await $.store.get(key))
    if (gen === ownGen) ownBytes = { owner: id, bytes: n }
    return n
  } catch {
    return null
  }
}

// The folder a board is shown under: the last folder name of the session root (not of the working
// folder, which moves into subfolders), so one project keeps one name. Stored as `cwdName`, beside
// `rootHash`, the hash of the root's full path (boards.js rootHashOf).
async function folderName($) {
  return cwdNameOf(await $.session.root())
}

// ---- The small state values (their shapes: view-state.js)

async function readHandover($) {
  return handoverOf((await $.state.get(HANDOVER)).value)
}

async function readView($) {
  return viewOf((await $.state.get(VIEW)).value)
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
    return shownCards(await storedCards($, id))
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

// ---- The cards changed since the person's latest prompt (recent.js)

// This load's marks of the current turn, with the bases the line counts need: { owner, turn, cards }
// or null. Kept here rather than read back from $.state, which a dispatch reads as it stood at its
// first read; the tools that write them run one at a time in `exclusive`. $.state gets a copy
// without the bases (`recent`) for the drawings.
let recentMarks = null

// The setting `staleHours` (stale.js), read once a load like the others; module-wide because the
// tools (list_cards' titles_only) read it as well as the drawings
let staleHours = STALE_DEFAULT_HOURS

// The setting `maxCards` (board.js maxCardsOf) and the tools built for it (tools.js toolsFor), read
// once a load like the others; module-wide because the tool calls, the hand-over and the
// compaction note all take the limit
let maxCards = LIMITS.cards
let tools = TOOLS

// The person's prompt: the turn moves on (the drawings stop showing the last turn's marks)
async function nextTurn($, e) {
  if (!isPersonPrompt(e)) return
  try {
    const id = await $.session.id()
    await $.state.set(TURN, turnAfter((await $.state.get(TURN)).value, id))
    recentMarks = null
  } catch {}
}

// After a tool's write that turned `before` into `after`: the cards it changed are marked for the
// current turn. With no turn known (no prompt yet, the counter lost) nothing is marked. A failure
// here never fails the write.
async function markChanged($, before, after) {
  try {
    const id = await $.session.id()
    const turn = readTurn((await $.state.get(TURN)).value, id)
    if (turn === null) return
    if (recentMarks === null || recentMarks.owner !== id || recentMarks.turn !== turn) {
      // After a reload the state may still hold this turn's marks; they are taken back
      recentMarks = { owner: id, turn, cards: seedMarks(marksOf((await $.state.get(RECENT)).value, id, turn)) }
    }
    const cards = markWrite(recentMarks.cards, before, after)
    if (cards === recentMarks.cards) return
    recentMarks = { owner: id, turn, cards }
    await $.state.set(RECENT, { owner: id, turn, cards: shownMarks(cards) })
  } catch {}
}

// The marks the drawings show: this session's, of the current turn; {} otherwise or on a failure
async function marksNow($) {
  try {
    const id = await $.session.id()
    const turn = readTurn((await $.state.get(TURN)).value, id)
    return marksOf((await $.state.get(RECENT)).value, id, turn)
  } catch {
    return {}
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
      // A 0.9.0 seal sits in the meta (its size changes: measured again at the next drawing)
      if (meta?.handedOver) {
        forgetOwnSize()
        await $.store.set(metaKey(id), mergeMeta(meta, { handedOver: null }))
      }
      patch = { sealed: null, last: { text: `書けるように戻しました。この${BOARD_NAME}は、また引き継ぎの候補に出ます` } }
    } catch (error) {
      patch = { last: { text: `書けるように戻せませんでした: ${messageOf(error)}` } }
    }
    await patchHandover($, patch)
  })
}

// ---- The other sessions' boards

// The store's keys and the values under the mod's own: { keys, values (a Map by key) }
async function readMine($) {
  const keys = await $.store.keys()
  const values = new Map()
  for (const key of keys) if (isMine(key)) values.set(key, await $.store.get(key))
  return { keys, values }
}

// Every other session's board in the store: { entries, bytes }
async function scanStore($) {
  const { keys, values } = await readMine($)
  return scanEntries(await $.session.id(), keys, values)
}

// list_cards with `others: true` (others.js): the earlier boards of this project, read from the
// store. Not in `exclusive` and not through runTool: it reads no card of this session and writes
// nothing (no state, no store, no mark), so this board's revision and the seal's state stay as
// they are. Refused while the setting `handover` is off, which governs keeping boards findable.
async function readOtherBoards($, e) {
  if (!handoverOn()) return { deny: OTHERS_OFF }
  try {
    const me = await $.session.id()
    const root = await $.session.root()
    const cwdName = cwdNameOf(root)
    const rootHash = rootHashOf(root)
    const { keys, values } = await readMine($)
    const out = answerOthers(projectBoards(me, rootHash, keys, values), e, { me, cwdName, rootHash })
    return out.error ? { deny: out.error } : { result: out.text }
  } catch (error) {
    return { deny: `前のセッションのボードを読めませんでした: ${messageOf(error)}` }
  }
}

// list_cards: this session's board, or with `others` the earlier ones
async function listCards($, e) {
  const mode = othersMode(e)
  if (mode === 'own') return runTool($, tools.list_cards, e)
  if (mode === 'others') return readOtherBoards($, e)
  return { deny: mode.error }
}

// Reads the other boards from the store into $.state (`others`), with `notice` as the line the
// frame shows above the list ('' for none); written only if it differs from what is there
function refreshOthers($, notice) {
  if (!handoverOn()) return Promise.resolve()
  return exclusiveOthers(async () => {
    const options = { me: await $.session.id(), cwdName: await folderName($), notice, handover: true }
    const next = othersOf(await scanStore($), options)
    await setOthers($, next)
  })
}

// The other boards as the state holds them
async function readOthers($) {
  if (!handoverOn()) return NO_OTHERS
  return othersValueOf((await $.state.get(OTHERS)).value)
}

// The board of the short id a button carries, as the list holds it
async function listed($, sid8) {
  return (await readOthers($)).boards.find((b) => b.sid8 === sid8)
}

// ---- The hand-over

// What the confirmation step keeps of a plan: the cards it names, not the cards themselves
const slim = ({ added, duplicates, overflow, limit }) => ({ added, duplicates, overflow, limit })

// Copies the cards of the board `row` in after this session's, then seals it (the `seal:` key of
// the source; its cards and meta are not touched). With cards on this board, a first call
// (`confirm` null) only stages the confirmation; the call that comes from [この内容で引き継ぐ]
// carries the staged `confirm` and goes on if the boards are as they were, else stages it again.
// This session's own seal and cards are read inside `exclusive`, from the store. Answers the line
// for the frame ('' when there is none).
async function handOver($, row, confirm) {
  const me = await $.session.id()
  // Without their `prev`: a hand-over does not copy what undo_card would bring back
  const source = shownCards(boardCardsOf(await $.store.get(storeKey(row.sid))))
  if (source.length === 0) return goneText()
  // A board sealed already is not taken over again, whoever sealed it (the list it was pressed in
  // is old)
  const taken = (await readSealState($, row.sid)).sealed
  if (taken) return taken.to === me ? alreadyMineText() : ALREADY(taken)
  const now = await $.clock.now()
  const cwdName = await folderName($)
  return exclusive(async () => {
    // This board may have been sealed since the pane last looked: nothing is written to it then
    const own = (await readSealState($, me)).sealed
    if (own) {
      const text = selfSealedText()
      await patchHandover($, { sealed: own, last: { text } })
      await patchView($, { confirm: null })
      return text
    }
    const board = await storedBoard($, me)
    const current = board.cards
    // The ids of this board's removed cards count as taken (planHandover), so the step is shown
    // on an empty board too when a card would be skipped for one of them
    const plan = planHandover(current, source, maxCards, now, { removed: board.removed })
    const sig = cardsSig(current) + '|' + cardsSig(source) + '|' + board.removed.map((c) => c.id).join(',')
    const confirmed = confirm !== null && confirm.sig === sig
    const plain = current.length === 0 && plan.duplicates.length === 0
    if ((!plain && !confirmed) || plan.added.length === 0) {
      // shown: the step is seen even when the board had no cards at the press and got one since
      const recounted = confirm !== null && !confirmed
      await patchView($, { shown: true, confirm: { sid8: row.sid8, sig, plan: slim(plan), recounted } })
      return ''
    }
    // The copy first, then the seal: a seal without a copy is never left behind
    const handedFrom = { sid: row.sid, sid8: row.sid8, cwdName: row.cwdName, updatedAt: row.updatedAt, count: row.count, at: now }
    await commitBoard($, board, plan.cards, { handedFrom })
    let text = handoverText(plan, row, now)
    try {
      await $.store.set(sealKey(row.sid), { to: me, toSid8: shortId(me), toCwdName: cwdName, at: now })
      // Another session may have taken the same board over at the same moment
      const after = (await readSealState($, row.sid)).sealed
      if (after && after.to !== me) {
        text += `同じ${BOARD_NAME}を、ほぼ同時に別のセッション（${after.toCwdName} · ID ${after.toSid8}）も引き継ぎました。どちらにも写しがあります`
      }
    } catch (error) {
      text = `カードは写しましたが、元の${BOARD_NAME}を読み取り専用にできませんでした（${messageOf(error)}）。元の${BOARD_NAME}は、この一覧に残ります`
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

// ---- The pane's view

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

// A change to a part of the view kept with this session's id (fold.js, search.js, order.js), so
// after /clear it reads as the default; the cards and the store are not touched. `make` answers
// the view to write from the view as it stands in the queue and the id, read before the queue.
async function patchOwnView($, make) {
  const me = await $.session.id()
  return exclusiveState(async () => setView($, make(await readView($), me)))
}

// [続きを表示（残り N 行）] / [畳む] on a long card. `rev` is the card's revision as drawn, `ids` the
// cards the pane drew (fold.js foldsAfter).
function setFold($, id, open, rev, ids) {
  return patchOwnView($, (view, me) => ({ ...view, folds: foldsAfter(view.folds, me, id, open, rev, ids) }))
}

// The search field's text, typed or cleared (search.js)
function setFilter($, text) {
  return patchOwnView($, (view, me) => ({ ...view, filter: filterAfter(me, text) }))
}

// [絞り込みを解く], and the pane opened again: the filter is let go and the field drawn anew, empty
function clearFilter($) {
  return exclusiveState(async () => setView($, filterCleared(await readView($))))
}

// [並び: …]: the order `by` the press asked for (not a toggle of what is stored, so a press that
// ran late sets what its label said)
function setOrder($, by) {
  return patchOwnView($, (view, me) => ({ ...view, order: orderAfter(me, by) }))
}

// This session's part of the view for the drawing (`read` takes the session id), or `fallback`
// on a failure: the fold choices ({}), the search field's text ('') and the order ('added')
async function ownPart($, read, fallback) {
  try {
    return read(await $.session.id())
  } catch {
    return fallback
  }
}

// ---- What the drawings read, and the entrances

// Opens the pane: /whiteboard and the band's button. The seal and the other sessions' boards are
// read again first (and the line about the last action is let go, the pane's view starts afresh
// but for the long cards' fold choices; the search field starts empty), so the pane is as the
// store has it now.
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
    await clearFilter($)
  } catch {}
  return $.ui.open({ id: PANE_ID, title: BOARD_NAME })
}

// What a tool call does (the table: tools.js). Every call looks at the seal in the store first: a
// write to a sealed board is refused before it touches the cards, list_cards reads on and says the
// board is sealed. A seal that cannot be read is not "no seal": a write is refused then
// (list_cards reads on).
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
      const board = await loadBoard($)
      const before = board.cards
      // The context: the board's revision, the read-only line first on a sealed board, the time and
      // the setting for the stale flag (list_cards), the removed cards (undo_card), the card limit
      // (set_card, undo_card)
      const now = await $.clock.now()
      const change = tool.apply(before, e, now, { rev: board.rev, notice: sealed ? sealedListLine(sealed) : '', removed: board.removed, now, staleHours, maxCards })
      if (tool.writes && !change.error && change.cards !== before) {
        await commitBoard($, board, change.cards)
        // Marked for the person's current turn (a hand-over's copy never comes this way)
        await markChanged($, before, change.cards)
      }
      return change
    })
    return outcome.error ? { deny: outcome.error } : { result: outcome.text }
  } catch (error) {
    return { deny: `${tool.writes ? 'ボードを保存できませんでした' : 'ボードを読めませんでした'}: ${messageOf(error)}` }
  }
}

// After a compaction the summary row gets one more text block at its end: the board's table of
// contents (compactionNote), so the model still knows the board is there and what is on it. Read
// from the store inside `exclusive`, as the tools read it. Every other row, a subagent's included,
// goes on as it came; so does the summary when the board is empty or anything here fails, so a
// compaction never depends on the board.
async function withCompactionNote($, e) {
  if (!isCompactionSummary(e)) return e
  try {
    const id = await $.session.id()
    const cards = await exclusive(() => storedCards($, id))
    if (cards.length === 0) return e
    const sealed = (await readSealState($, id)).sealed !== null
    const text = compactionNote(cards, { sealed, maxCards })
    if (text === '') return e
    return { ...e, message: { ...e.message, content: [...e.message.content, { type: 'text', text }] } }
  } catch (error) {
    try {
      $.ui.log(`whiteboard: 圧縮の要約にボードの目次を足せませんでした: ${messageOf(error)}`, { to: 'debug' })
    } catch {}
    return e
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
    if (isPersonPrompt(e) && note.firstPrompt === undefined) {
      const line = promptLine(e.prompt)
      if (line !== '') note.firstPrompt = line
    }
    noted.set(id, note)
  } catch {}
}

export function register(on, options) {
  setConfig(options)
  noted.clear()
  recentMarks = null
  forgetOwnSize()
  staleHours = staleHoursOf(options)
  maxCards = maxCardsOf(options)
  tools = toolsFor(maxCards)
  const guideMode = guideModeOf(options)
  // The setting `colors`, read once a load like the others
  const palette = paletteOf(options)
  // The setting `styleMarks` (off unless true): a shape per colour name before the title
  const shapes = shapesOn(options)
  // The setting `bandTitle` (on unless false): the band shows a pinned card's title
  const bandTitle = options?.bandTitle !== false
  // The turns' count lives in this load only (a hot reload starts it again)
  const guideTurns = makeGuideTurns(keywordsOf(options))

  // Fires on the session's start, and again after a hot reload
  on('session.start', async ($, e, next) => {
    for (const [name, tool] of Object.entries(tools)) {
      await $.tool.register({ name, description: tool.description, inputSchema: tool.inputSchema })
    }
    await $.command.register({ name: 'whiteboard', description: `${BOARD_NAME}を開く` })
    try {
      await exclusive(() => loadBoard($))
    } catch {}
    // The seal and the record of where the cards came from, which the store keeps
    try {
      await syncOwn($)
    } catch {}
    // With the board empty, the boards that may be taken over, once (the band says so); with
    // cards, they are read when the pane is opened
    try {
      if ((await cardsOf($)).length === 0) await refreshOthers($, '')
    } catch {}
    return next(e)
  })

  // One hook per tool, the matcher written out so that validate can list it
  on('tool.call', { tool: 'mcp__whiteboard__set_card' }, ($, e) => runTool($, tools.set_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__edit_card' }, ($, e) => runTool($, tools.edit_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__append_card' }, ($, e) => runTool($, tools.append_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__remove_card' }, ($, e) => runTool($, tools.remove_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__clear' }, ($, e) => runTool($, tools.clear, e))
  on('tool.call', { tool: 'mcp__whiteboard__list_cards' }, ($, e) => listCards($, e))
  on('tool.call', { tool: 'mcp__whiteboard__undo_card' }, ($, e) => runTool($, tools.undo_card, e))

  // The guide: one fixed section at the end of the system prompt, the same text on every call
  // (nothing of the cards in it), so the prompt cache is not spent. Off: nothing is added.
  on('prompt.compose', async ($, e, next) => withGuide(await next(e), e.traits, guideMode))

  // The person's first request and the session's title are kept for the meta (the list tells
  // boards apart by them). full: when the person's message holds a keyword, the lines on which
  // tool to use are handed to the model with it (additionalContext); the message itself is not
  // changed. Not more than once in a few turns. Only the person's own messages count. The person's
  // prompt also starts a new turn for the marks of the cards Claude changes (recent.js).
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteRequest($, e)
    await nextTurn($, e)
    const result = await next(e)
    if (guideMode !== 'full' || !isPersonPrompt(e)) return result
    const lines = guideTurns(e.prompt)
    if (lines === '') return result
    return { ...result, additionalContext: [...(result?.additionalContext ?? []), lines] }
  })

  // The board's table of contents after a compaction (withCompactionNote); next is called once,
  // with the row as it came when nothing is added. The catch covers a throw or an overrun (a store
  // that does not answer): the row goes on as it came, or as `next` already stored it.
  on('session.append', { door: 'compaction' }, async ($, e, next) => next(await withCompactionNote($, e))).catch(($, e, next) => next(e))

  // /whiteboard opens the pane (a helper: the band's button is the way in)
  on('command.run', { command: 'whiteboard' }, async ($) => {
    const opened = await openPane($)
    return { text: opened?.isPlaced === false ? `${BOARD_NAME}を開きました（まだ表示されていません）` : `${BOARD_NAME}を開きました` }
  })

  on('ui.render', { component: 'Pane', requestId: 'whiteboard' }, async ($, e) => {
    // The Buttons' presses are guarded (press-guard.js): the first press on an unfocused pane can be lost
    const guard = guardDrawing(e.requestId)
    const ui = guard.wrap($.ui.resolve(e))
    const view = await readView($)
    const data = {
      cards: await cardsOf($),
      others: await readOthers($),
      handover: await readHandover($),
      view,
      folds: await ownPart($, (me) => foldsOf(view.folds, me), {}),
      filter: await ownPart($, (me) => filterOf(view.filter, me), ''),
      order: await ownPart($, (me) => orderOf(view.order, me), 'added'),
      enabled: handoverOn(),
      now: await nowOf($),
      palette,
      shapes,
      marks: await marksNow($),
      ownBytes: await ownSize($),
      staleHours,
    }
    const actions = {
      peek: (sid8) => peek($, sid8),
      take: (sid8) => take($, sid8, null),
      takeConfirm: () => takeConfirm($),
      takeCancel: () => patchView($, { confirm: null }),
      toggleShown: () => toggleShown($),
      fold: (id, open, rev, ids) => setFold($, id, open, rev, ids),
      filter: (text) => setFilter($, text),
      clearFilter: () => clearFilter($),
      order: (by) => setOrder($, by),
      unseal: () => unseal($),
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
    const card = bandTitle ? bandCard(cards) : null
    const marks = await marksNow($)
    const changed = markedCount(marks, cards)
    // Worked out at each drawing, no timer: a card turns stale at the next redraw
    const stale = staleCount(cards, await nowOf($), staleHours, marks)
    const mine = drawBand(ui, e.surface, widthOf(e), cards.length, hint, () => openPane($), { card, palette, changed, stale, shapes })
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
