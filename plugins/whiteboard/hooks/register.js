// A whiteboard Claude writes to: titled Markdown cards (steps, running jobs, links) that stay put instead of scrolling away in the chat
//
// register.js  every hook and every $ call: the tool calls, the boards' load and save, attaching a
//              session to a board, the move of 0.10.0's boards, the pane and the band, /whiteboard
// tools.js     the tools Claude calls: the seven card tools (set_card, edit_card, append_card,
//              remove_card, clear, list_cards, undo_card), what each is told, its input, and what it
//              does to the cards; the three board tools (open_board, list_boards, rename_board) (pure)
// board.js     the limits, what each card tool does to the cards and answers, the band's fit (pure)
// boards.js    the named boards: the keys, the meta, the root's hash, the list's groups (pure)
// migrate.js   what becomes of a board of 0.10.0 and before (pure)
// shelf.js     the store's keys turned into the list of boards (pure)
// catalog.js   what Claude reads about the boards: the board tools' answers, the refusals (pure)
// view-state.js  the small state values read with their defaults (pure)
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
// A board belongs to no session (boards.js): `b:<boardId>` holds its record (the cards with the
// board's revision and the cards removed lately, which undo_card brings back; board.js), written in
// one store write, and `bm:<boardId>` its name, project, times, count and the title of the session
// that wrote it last. `attach:<sessionId>` says which board a session is attached to; a new session
// is attached to none, and the card tools refuse until Claude attaches it (open_board) or the person
// does ([つなぐ] in the pane). Several sessions may be attached to one board. So the boards outlive
// the app and the session: the same session opened again is still attached, and any session may
// attach to a board by its name. The store is written first; a write it refuses (a store over its
// size limit) leaves the board as it was and the tool answers an error.
//
// The rule for the cards: the store is the truth and $.state is a copy for the drawings. What is
// read to be written over (the tools, an attach) is read from the store, inside `exclusive`. It is
// never read from $.state: one dispatch (a tool call, a press) reads $.state as it stood at its
// first read and keeps that. The state's `owner` and `attached` say whose cards `cards` holds (after
// /clear the process goes on under another session id), and the drawings do not take cards of
// another owner. Another session attached to the same board writes the store only, so this
// session's drawings show its writes at this session's next read (a tool call, the pane opened);
// and a write reads the board's revision again just before it saves, refusing when another session
// wrote in between.
//
// The engine follows $ into the functions of the file it is in and never across an import (validate
// refuses $ passed to an imported function), so everything that takes $ is here; the other modules
// are pure.

import {
  LIMITS,
  maxCardsOf,
  isBoardRecord,
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
  clockOf,
} from './board.js'
import { boardKey, metaKey, attachKey, readMeta, mergeMeta, readAttach, rootOf, promptLine, isText, nameOf, newBoardId, findByName, nameTaken, NAME_LIMIT } from './boards.js'
import { oldKeysOf, oldSessionsOf, planMove } from './migrate.js'
import { isSame, isMine, isMetaKey, scanBoards, listSigOf } from './shelf.js'
import { NOT_ATTACHED, CHANGED_MEANWHILE, listBoardsText, attachedText, alreadyText, renamedText, takenText } from './catalog.js'
import { TOOLS, toolsFor, BOARD_TOOLS } from './tools.js'
import { NO_VIEW, attachedOf, viewOf, boardsOf, rootValueOf, aboutOf } from './view-state.js'
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
const ATTACHED = { plugin: 'whiteboard', key: 'attached' }
const BOARDS = { plugin: 'whiteboard', key: 'boards' }
const ROOT = { plugin: 'whiteboard', key: 'root' }
const ABOUT = { plugin: 'whiteboard', key: 'about' }
const VIEW = { plugin: 'whiteboard', key: 'view' }
const TURN = { plugin: 'whiteboard', key: 'turn' }
const RECENT = { plugin: 'whiteboard', key: 'recent' }

// The cards and the attachments have a queue (the tools, an attach, the start's move and load);
// the list of boards has one of its own, so a tool never waits on it; the small state values
// (`view`) have a third
const exclusive = makeQueue()
const exclusiveBoards = makeQueue()
const exclusiveState = makeQueue()

const messageOf = (error) => String(error?.message ?? error)

// The board a session is attached to when none is: no cards, no name
const NONE = { board: null, name: '', stamp: 0 }

// The `attached` state value for the board `att` ({ id, meta }, or null for none): with the meta's
// time of the last write (`stamp`), which tells a read later whether anyone wrote the board since
const attachedValue = (me, att) => (att === null ? { owner: me, ...NONE } : { owner: me, board: att.id, name: att.meta.name, stamp: att.meta.updatedAt })

// ---- The root and what the session is about

// The session root as this session first saw it ({ name, hash }), fixed in $.state: the app may
// move the working folder (and with it the root) into a nested repository, which must not move the
// boards to another project. Read once and kept; a drawing reads it with rootForDrawing.
async function fixedRoot($) {
  const me = await $.session.id()
  const held = rootValueOf((await $.state.get(ROOT)).value, me)
  if (held !== null) return held
  const root = rootOf(await $.session.root())
  await $.state.set(ROOT, { owner: me, ...root })
  return root
}

// The same for a drawing, which may not write the state; null when it cannot be read
async function rootForDrawing($) {
  try {
    const held = rootValueOf((await $.state.get(ROOT)).value, await $.session.id())
    return held ?? rootOf(await $.session.root())
  } catch {
    return null
  }
}

// The session's title and the person's first request, kept in $.state (they outlive a hot reload
// there): the title from the classic SessionStart and each UserPromptSubmit, the first request once
async function noteAbout($, e) {
  try {
    const me = await $.session.id()
    const about = aboutOf((await $.state.get(ABOUT)).value, me)
    let { title, firstPrompt } = about
    if (isText(e?.session_title)) title = promptLine(e.session_title) || title
    if (e?.hook_event_name !== 'SessionStart' && isPersonPrompt(e) && firstPrompt === null && isText(e?.prompt)) firstPrompt = promptLine(e.prompt) || null
    if (title !== about.title || firstPrompt !== about.firstPrompt) await $.state.set(ABOUT, { owner: me, title, firstPrompt })
    // A new title (the app names a session after its first prompt, so the title often comes after
    // the first card was written): the board this session wrote last takes it
    if (title !== null && title !== about.title) await retitleBoard($, me, title)
  } catch {}
}

// Puts the session's new title on the board it is attached to, when this session wrote that board
// last (`lastSid`) under another title; another session's title is never written over. Only a
// title that changed in the state comes here, so a prompt with the same title reads nothing.
function retitleBoard($, me, title) {
  return exclusive(async () => {
    const att = await attachmentOf($, me)
    if (att === null || att.meta.lastSid !== me || att.meta.lastTitle === title) return
    await $.store.set(metaKey(att.id), mergeMeta(att.meta, { lastTitle: title }))
    // The list the pane holds takes it too, without reading the store again
    await exclusiveBoards(async () => {
      const { value } = await $.state.get(BOARDS)
      if (value == null || !Array.isArray(value.rows) || !value.rows.some((r) => r?.id === att.id)) return
      await $.state.set(BOARDS, { ...value, rows: value.rows.map((r) => (r?.id === att.id ? { ...r, lastTitle: title } : r)) })
    })
  })
}

// What the meta keeps of the session that wrote a board last: its title, else its first request
// (in 「」), else the first thing the person typed as the transcript has it (a session the mod was
// loaded into after its first prompt); null when none is known
async function sessionTitle($, me) {
  try {
    const about = aboutOf((await $.state.get(ABOUT)).value, me)
    if (about.title !== null) return about.title
    if (about.firstPrompt !== null) return `「${about.firstPrompt}」`
    const messages = await $.session.messages()
    const first = Array.isArray(messages) ? messages.find((m) => m?.role === 'user' && isText(m.text) && !(Array.isArray(m.toolResults) && m.toolResults.length > 0)) : undefined
    const line = first ? promptLine(first.text) : ''
    if (line === '') return null
    await $.state.set(ABOUT, { owner: me, title: null, firstPrompt: line })
    return `「${line}」`
  } catch {
    return null
  }
}

// ---- The boards in the store

// The board `id` as the store has it, the truth (see the top of this file): { cards, rev, removed } (board.js readBoard)
async function storedBoard($, id) {
  return readBoard(await $.store.get(boardKey(id)))
}

// The board the session `me` is attached to, as the store has it: { id, meta }, or null when it is
// attached to none (or to a board whose meta is gone)
async function attachmentOf($, me) {
  const att = readAttach(await $.store.get(attachKey(me)))
  if (att === null) return null
  const meta = readMeta(await $.store.get(metaKey(att.board)))
  return meta === null ? null : { id: att.board, meta }
}

// Puts the cards of the board `att` ({ id, meta }, or null for none) into $.state for the drawings
// ($.state holds the cards without `prev`), with whose they are
async function showBoard($, me, att, cards) {
  await $.state.set(CARDS, att === null ? [] : shownCards(cards))
  await $.state.set(OWNER, me)
  await $.state.set(ATTACHED, attachedValue(me, att))
}

// The board this session is attached to, from the store; $.state is brought in line when it
// differs. { me, att, board } (att and board null when attached to none). Call it inside
// `exclusive`, not from a press before it waits there.
async function loadBoard($) {
  const me = await $.session.id()
  const att = await attachmentOf($, me)
  const board = att === null ? null : await storedBoard($, att.id)
  const shown = att === null ? [] : shownCards(board.cards)
  const attached = attachedValue(me, att)
  if (!isSame((await $.state.get(CARDS)).value, shown) || (await $.state.get(OWNER)).value !== me || !isSame((await $.state.get(ATTACHED)).value, attached)) {
    await showBoard($, me, att, board?.cards ?? [])
  }
  return { me, att, board }
}

// Writes the board's record to the store (one write: the cards, the revision and the removed
// cards together) and then the cards to $.state; the drawings read the state. An emptied board
// keeps its record (board.js). The meta follows: the time, the count and the session that wrote
// it; a meta the store refuses is let go (the list then shows the time before).
async function saveBoard($, me, att, board) {
  const record = boardRecord(board)
  if (record === null) await $.store.delete(boardKey(att.id))
  else await $.store.set(boardKey(att.id), record)
  let meta = null
  try {
    const prev = readMeta(await $.store.get(metaKey(att.id))) ?? att.meta
    const lastTitle = await sessionTitle($, me)
    // The writer's id goes with its title (null when no title is known: another session's title is not kept for it)
    const next = mergeMeta(prev, { updatedAt: await $.clock.now(), count: board.cards.length, lastTitle: lastTitle ?? null, lastSid: lastTitle === null ? null : me })
    await $.store.set(metaKey(att.id), next)
    meta = readMeta(next)
  } catch {}
  await $.state.set(CARDS, shownCards(board.cards))
  await $.state.set(OWNER, me)
  // This session's own write is no news to it at the next boundary (syncBoard)
  if (meta !== null) await $.state.set(ATTACHED, attachedValue(me, { id: att.id, meta }))
  await pruneView($, me, board.cards)
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

// Saves a write: `after`, what a tool made of `board`'s cards (the board as read in the same turn
// of `exclusive`), with each card's previous version (trackPrev), the revisions stamped on
// (stampRevs) and the removed cards brought in line (removedAfter: a card gone from the board joins
// them, one back on the board leaves them). Answers the board's revision after it.
async function commitBoard($, me, att, board, after) {
  const stamped = stampRevs(board.cards, trackPrev(board.cards, after), board.rev)
  const { removed } = removedAfter(board.removed, board.cards, stamped.cards)
  await saveBoard($, me, att, { cards: stamped.cards, rev: stamped.rev, removed })
  return stamped.rev
}

// The store's keys and the values under the mod's own, turned into the list (shelf.js scanBoards)
async function scanStore($) {
  const keys = await $.store.keys()
  const values = new Map()
  for (const key of keys) if (isMine(key)) values.set(key, await $.store.get(key))
  return scanBoards(keys, values)
}

// ---- Attaching

// Attaches the session `me` to the board `id` (it must have a meta): the store first, then the
// state; a board that was old is used again, so it is not old any more. The view's choices on the
// cards of the board before (folds, the filter) and this turn's marks are let go. Call it inside
// `exclusive`. Answers { meta, board }.
async function attachTo($, me, id) {
  const meta = readMeta(await $.store.get(metaKey(id)))
  if (meta === null) throw new Error(`その${BOARD_NAME}は、もうありません`)
  await $.store.set(attachKey(me), { board: id, at: await $.clock.now() })
  if (meta.old) await $.store.set(metaKey(id), mergeMeta(meta, { old: null }))
  const board = await storedBoard($, id)
  await showBoard($, me, { id, meta }, board.cards)
  recentMarks = null
  await $.state.set(RECENT, { owner: me, turn: 0, cards: {} })
  await exclusiveState(async () => setView($, filterCleared({ ...(await readView($)), pick: '', shown: false, rename: false, folds: null })))
  return { meta: { ...meta, old: false }, board }
}

// open_board: attaches to the board of that name (this project's first), or makes it
async function openBoard($, e) {
  const named = nameOf(e?.name)
  if (named.error) return { deny: named.error }
  try {
    const text = await exclusive(async () => {
      const me = await $.session.id()
      const root = await fixedRoot($)
      const { rows } = await scanStore($)
      const found = findByName(rows, named.name, root.hash)
      if (found !== null) {
        const current = readAttach(await $.store.get(attachKey(me)))
        if (current?.board === found.id) {
          await loadBoard($)
          return alreadyText(found)
        }
        await attachTo($, me, found.id)
        return attachedText(found, { project: root.hash !== null && found.rootHash === root.hash })
      }
      const now = await $.clock.now()
      const id = newBoardId(now, Math.random())
      await $.store.set(metaKey(id), mergeMeta(null, { name: named.name, rootHash: root.hash, cwdName: root.name, createdAt: now, updatedAt: now, count: 0 }))
      await attachTo($, me, id)
      return attachedText({ name: named.name }, { created: true })
    })
    await refreshBoards($).catch(() => {})
    return { result: text }
  } catch (error) {
    return { deny: `ボードにつなげませんでした: ${messageOf(error)}` }
  }
}

// list_boards: the boards, read from the store; nothing is written but the root, once
async function listBoards($, e) {
  if (e?.all !== undefined && typeof e.all !== 'boolean') return { deny: 'all は true か false で指定してください' }
  try {
    const me = await $.session.id()
    const root = await fixedRoot($)
    const { rows } = await scanStore($)
    const att = await attachmentOf($, me)
    return { result: listBoardsText(rows, { rootHash: root.hash, cwdName: root.name, current: att?.id ?? null, all: e?.all === true }) }
  } catch (error) {
    return { deny: `ボードの一覧を読めませんでした: ${messageOf(error)}` }
  }
}

// Gives the board this session is attached to the name `name` (checked already): { from, to },
// { taken: true } when another board of its project has it, { unattached: true } with no board
function renameAttached($, name) {
  return exclusive(async () => {
    const me = await $.session.id()
    const att = await attachmentOf($, me)
    if (att === null) return { unattached: true }
    const root = await fixedRoot($)
    const { rows } = await scanStore($)
    if (nameTaken(rows, name, att.meta.rootHash ?? root.hash, att.id)) return { taken: true }
    const meta = readMeta(await $.store.get(metaKey(att.id))) ?? att.meta
    if (meta.name !== name) {
      await $.store.set(metaKey(att.id), mergeMeta(meta, { name }))
      await $.state.set(ATTACHED, { owner: me, board: att.id, name, stamp: meta.updatedAt })
    }
    return { from: meta.name, to: name }
  })
}

// rename_board
async function renameBoard($, e) {
  const named = nameOf(e?.name)
  if (named.error) return { deny: named.error }
  try {
    const out = await renameAttached($, named.name)
    if (out.unattached) return { deny: NOT_ATTACHED }
    if (out.taken) return { deny: takenText(named.name) }
    await refreshBoards($).catch(() => {})
    return { result: renamedText(out.from, out.to) }
  } catch (error) {
    return { deny: `ボードの名前を変えられませんでした: ${messageOf(error)}` }
  }
}

// ---- Reading again at the turn's boundaries (no timer)

// The board this session is attached to, read again when another session may have written it: a
// cheap look first (the attachment and the meta's time of the last write, against $.state), and
// the cards only when they moved. Cards read this way are not marked as this session's changes
// (recent.js marks only this session's own tool writes). A failure is let go.
async function syncBoard($) {
  try {
    await exclusive(async () => {
      const me = await $.session.id()
      const held = attachedOf((await $.state.get(ATTACHED)).value, me)
      const att = await attachmentOf($, me)
      const same = held !== null && (att?.id ?? null) === held.board && (att === null || (att.meta.updatedAt === held.stamp && att.meta.name === held.name))
      if (!same) await loadBoard($)
    })
  } catch {}
}

// The list of boards, read again when the pane would draw it (attached to none, or the other
// boards shown) and the boards' metas moved since it was read; the line about the last action stays
async function syncList($) {
  try {
    const me = await $.session.id()
    const held = attachedOf((await $.state.get(ATTACHED)).value, me)
    if (held !== null && held.board !== null && !(await readView($)).shown) return
    const keys = await $.store.keys()
    const metas = new Map()
    for (const key of keys) if (isMetaKey(key)) metas.set(key, await $.store.get(key))
    const boards = boardsOf((await $.state.get(BOARDS)).value, me)
    if (boards.sig === listSigOf(keys, metas)) return
    await refreshBoards($)
  } catch {}
}

// [読み直す]: the board and the list, from the store now, whatever moved; a toast says so
async function reloadNow($) {
  try {
    await exclusive(() => loadBoard($))
    await refreshBoards($)
    say($, `${clockOf(await nowOf($))} に読み直しました`)
  } catch (error) {
    say($, `読み直せませんでした: ${messageOf(error)}`)
  }
  await patchView($, { shown: false, rename: false }).catch(() => {})
}

// What a press in the pane did, said in a toast: the pane shows the board only (a failing toast is let go)
function say($, text) {
  try {
    $.ui.toast(text)
  } catch {}
}

// ---- The move of 0.10.0's boards (migrate.js)

// Moves every board of 0.10.0 and before still in the store. Run at each session's start, inside
// `exclusive`: a board that could not be moved keeps its old keys and is tried again next time.
async function moveOldBoards($, root) {
  const keys = await $.store.keys()
  const sids = oldSessionsOf(keys)
  if (sids.length === 0) return
  const present = new Set(keys)
  const now = await $.clock.now()
  for (const sid of sids) {
    try {
      await moveOne($, sid, present, root, now)
    } catch (error) {
      noteNotMoved($, messageOf(error))
    }
  }
}

function noteNotMoved($, reason) {
  try {
    $.ui.log(`whiteboard: 前の版の${BOARD_NAME}を 1 つ移せませんでした（${reason}）。元のデータは残してあり、次の起動でもう一度試します`)
  } catch {}
}

// One old session's keys: the new keys written (unless a board moved from it is there already),
// read back, and only then the old keys deleted
async function moveOne($, sid, present, root, now) {
  const old = oldKeysOf(sid)
  const values = {}
  for (const [kind, key] of Object.entries(old)) values[kind] = present.has(key) ? await $.store.get(key) : undefined
  const plan = planMove(sid, values, root, now)
  if (plan.kind === 'broken') {
    noteNotMoved($, plan.reason)
    return
  }
  if (plan.kind === 'move') {
    // Another session that started at the same time may have moved it already: its keys stay
    const had = readMeta(await $.store.get(metaKey(plan.id))) !== null
    if (!had) {
      if (plan.record !== null) await $.store.set(boardKey(plan.id), plan.record)
      await $.store.set(metaKey(plan.id), plan.meta)
    }
    if (readAttach(await $.store.get(attachKey(sid))) === null) await $.store.set(attachKey(sid), plan.attach)
    const meta = await $.store.get(metaKey(plan.id))
    const record = await $.store.get(boardKey(plan.id))
    const sound = had
      ? readMeta(meta) !== null && (plan.record === null || isBoardRecord(record))
      : isSame(meta, plan.meta) && (plan.record === null || isSame(record, plan.record))
    if (!sound) throw new Error('書いた内容を読み戻せませんでした')
  }
  for (const key of Object.values(old)) if (present.has(key)) await $.store.delete(key)
}

// ---- The small state values (their shapes: view-state.js)

async function readView($) {
  return viewOf((await $.state.get(VIEW)).value)
}

// Writes a state value only when it differs from what is there (a write redraws the drawings).
// The engine wants the reference spelled out at each call, so one function for each value.
async function setView($, next) {
  const { value } = await $.state.get(VIEW)
  if (!isSame(value, next)) await $.state.set(VIEW, next)
}
async function setBoards($, next) {
  const { value } = await $.state.get(BOARDS)
  if (!isSame(value, next)) await $.state.set(BOARDS, next)
}

// A change to the view
function patchView($, patch) {
  return exclusiveState(async () => setView($, { ...(await readView($)), ...patch }))
}

// Reads the boards from the store into $.state (`boards`); written only if it differs from what is there
function refreshBoards($) {
  return exclusiveBoards(async () => {
    const me = await $.session.id()
    const { rows, bytes, sig } = await scanStore($)
    await setBoards($, { owner: me, rows, bytes, sig })
  })
}

// The board and its cards for a drawing: the state's, when they are this session's; else read from
// the store (a drawing may read the store, but may not write the state). { attached: { board,
// name } (board null for none), cards }.
async function shownBoard($) {
  try {
    const me = await $.session.id()
    const held = attachedOf((await $.state.get(ATTACHED)).value, me)
    if (held !== null) {
      if (held.board === null) return { attached: held, cards: [] }
      const { value } = await $.state.get(CARDS)
      if (Array.isArray(value) && (await $.state.get(OWNER)).value === me) return { attached: held, cards: value }
      return { attached: held, cards: shownCards((await storedBoard($, held.board)).cards) }
    }
    const att = await attachmentOf($, me)
    if (att === null) return { attached: NONE, cards: [] }
    return { attached: { board: att.id, name: att.meta.name }, cards: shownCards((await storedBoard($, att.id)).cards) }
  } catch {
    return { attached: NONE, cards: [] }
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
// once a load like the others; module-wide because the tool calls and the compaction note take the limit
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

// ---- The pane's actions

// [つなぐ]: attaches this session to the board, then the list is read again; a toast says what came of it
async function attachFromPane($, id) {
  try {
    const { meta } = await exclusive(async () => attachTo($, await $.session.id(), id))
    say($, `「${meta.name}」につなぎました`)
  } catch (error) {
    say($, `つなげませんでした: ${messageOf(error)}`)
  }
  await refreshBoards($).catch(() => {})
}

// [中身を見る] / [閉じる]: one board is open at a time
async function peek($, id) {
  const view = await readView($)
  await patchView($, { pick: view.pick === id ? '' : id })
}

// [表示] / [隠す] on a folded group of the list
async function showGroup($, name, open) {
  const view = await readView($)
  await patchView($, { groups: { ...view.groups, [name]: open === true } })
}

// [別のボードに切り替える] / [ほかのボードを閉じる]
async function toggleShown($) {
  const view = await readView($)
  if (!view.shown) await refreshBoards($).catch(() => {})
  await patchView($, { shown: !view.shown, pick: '' })
}

// [名前を変える]: the editor, under a new key so it starts empty
async function renameOpen($) {
  const view = await readView($)
  await patchView($, { rename: true, renameGen: view.renameGen + 1 })
}

// The name typed in the editor and Enter: an empty one closes the editor, anything else is checked
// as Claude's is, and a toast says what came of it. Done (or the same name), the row of buttons
// comes back; a name that cannot be taken keeps the editor open.
async function renameFromPane($, value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text === '') {
    await patchView($, { rename: false })
    return
  }
  const named = nameOf(text)
  if (named.error) {
    say($, `名前は ${NAME_LIMIT} 文字までです。短くしてください`)
    return
  }
  try {
    const out = await renameAttached($, named.name)
    if (out.unattached) say($, `この${BOARD_NAME}には、もうつながっていません`)
    else if (out.taken) say($, `このプロジェクトには「${named.name}」という名前の${BOARD_NAME}がもうあります。別の名前にしてください`)
    else {
      if (out.from !== out.to) say($, `名前を「${out.from}」から「${out.to}」に変えました`)
      await patchView($, { rename: false })
    }
  } catch (error) {
    say($, `名前を変えられませんでした: ${messageOf(error)}`)
  }
  await refreshBoards($).catch(() => {})
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

// Opens the pane: /whiteboard and the band's button. The board and the list are read again first
// (the line about the last action is let go, the pane's view starts afresh but for the long cards'
// fold choices and the order; the search field starts empty), so the pane is as the store has it now.
async function openPane($) {
  try {
    await exclusive(() => loadBoard($))
  } catch {}
  try {
    await refreshBoards($)
  } catch {}
  try {
    await patchView($, NO_VIEW)
    await clearFilter($)
  } catch {}
  return $.ui.open({ id: PANE_ID, title: BOARD_NAME })
}

// What a card tool's call does (the table: tools.js), on the board this session is attached to,
// read from the store; with none it is refused (NOT_ATTACHED). A write reads the board's revision
// again just before it saves: another session attached to the same board may have written it
// since, and the write is refused then (CHANGED_MEANWHILE), the state taking the board as it is.
async function runTool($, tool, e) {
  try {
    const outcome = await exclusive(async () => {
      const { me, att, board } = await loadBoard($)
      if (att === null) return { error: NOT_ATTACHED }
      const before = board.cards
      // The context: the board's revision, the time and the setting for the stale flag
      // (list_cards), the removed cards (undo_card), the card limit (set_card, undo_card)
      const now = await $.clock.now()
      const change = tool.apply(before, e, now, { rev: board.rev, removed: board.removed, now, staleHours, maxCards })
      if (tool.writes && !change.error && change.cards !== before) {
        const again = await storedBoard($, att.id)
        if (again.rev !== board.rev) {
          await showBoard($, me, att, again.cards)
          return { error: CHANGED_MEANWHILE }
        }
        await commitBoard($, me, att, board, change.cards)
        // Marked for the person's current turn
        await markChanged($, before, change.cards)
      }
      return change
    })
    return outcome.error ? { deny: outcome.error } : { result: outcome.text }
  } catch (error) {
    return { deny: `${tool.writes ? 'ボードを保存できませんでした' : 'ボードを読めませんでした'}: ${messageOf(error)}` }
  }
}

// After a compaction the summary row gets one more text block at its end: the attached board's
// table of contents (compactionNote), so the model still knows the board is there and what is on
// it. Read from the store inside `exclusive`, as the tools read it. Every other row, a subagent's
// included, goes on as it came; so does the summary when no board is attached, the board is empty
// or anything here fails, so a compaction never depends on the board.
async function withCompactionNote($, e) {
  if (!isCompactionSummary(e)) return e
  try {
    const me = await $.session.id()
    const found = await exclusive(async () => {
      const att = await attachmentOf($, me)
      return att === null ? null : { name: att.meta.name, cards: (await storedBoard($, att.id)).cards }
    })
    if (found === null || found.cards.length === 0) return e
    const text = compactionNote(found.cards, { name: found.name, maxCards })
    if (text === '') return e
    return { ...e, message: { ...e.message, content: [...e.message.content, { type: 'text', text }] } }
  } catch (error) {
    try {
      $.ui.log(`whiteboard: 圧縮の要約にボードの目次を足せませんでした: ${messageOf(error)}`, { to: 'debug' })
    } catch {}
    return e
  }
}

export function register(on, options) {
  recentMarks = null
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

  // Fires on the session's start, and again after a hot reload: the tools, the root fixed, the old
  // boards moved, this session's board (if any) and the list read
  on('session.start', async ($, e, next) => {
    for (const [name, tool] of [...Object.entries(tools), ...Object.entries(BOARD_TOOLS)]) {
      await $.tool.register({ name, description: tool.description, inputSchema: tool.inputSchema })
    }
    // A refused name throws, and a throw would skip the rest of this hook (the board would not load)
    try {
      await $.command.register({ name: 'whiteboard', description: `${BOARD_NAME}を開く` })
    } catch (error) {
      try {
        $.ui.log(`whiteboard: コマンド /whiteboard を登録できませんでした: ${messageOf(error)}`, { to: 'debug' })
      } catch {}
    }
    try {
      const root = await fixedRoot($)
      await exclusive(() => moveOldBoards($, root))
    } catch {}
    try {
      await exclusive(() => loadBoard($))
    } catch {}
    try {
      await refreshBoards($)
    } catch {}
    return next(e)
  })

  // One hook per tool, the matcher written out so that validate can list it
  on('tool.call', { tool: 'mcp__whiteboard__set_card' }, ($, e) => runTool($, tools.set_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__edit_card' }, ($, e) => runTool($, tools.edit_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__append_card' }, ($, e) => runTool($, tools.append_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__remove_card' }, ($, e) => runTool($, tools.remove_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__clear' }, ($, e) => runTool($, tools.clear, e))
  on('tool.call', { tool: 'mcp__whiteboard__list_cards' }, ($, e) => runTool($, tools.list_cards, e))
  on('tool.call', { tool: 'mcp__whiteboard__undo_card' }, ($, e) => runTool($, tools.undo_card, e))
  on('tool.call', { tool: 'mcp__whiteboard__open_board' }, ($, e) => openBoard($, e))
  on('tool.call', { tool: 'mcp__whiteboard__list_boards' }, ($, e) => listBoards($, e))
  on('tool.call', { tool: 'mcp__whiteboard__rename_board' }, ($, e) => renameBoard($, e))

  // The guide: one fixed section at the end of the system prompt, the same text on every call
  // (nothing of the cards in it), so the prompt cache is not spent. Off: nothing is added.
  on('prompt.compose', async ($, e, next) => withGuide(await next(e), e.traits, guideMode))

  // The session's title, which the app hands over at the start too (the board's meta keeps the
  // title of the session that wrote it last)
  on('classic.SessionStart', async ($, e, next) => {
    await noteAbout($, e)
    return next(e)
  })

  // The person's first request and the session's title are kept for the meta. full: when the
  // person's message holds a keyword, the lines on which tool to use are handed to the model with
  // it (additionalContext); the message itself is not changed. Not more than once in a few turns.
  // Only the person's own messages count. The person's prompt also starts a new turn for the marks
  // of the cards Claude changes (recent.js).
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteAbout($, e)
    await nextTurn($, e)
    // Another session on the same board may have written it since the last turn
    await syncBoard($)
    await syncList($)
    const result = await next(e)
    if (guideMode !== 'full' || !isPersonPrompt(e)) return result
    const lines = guideTurns(e.prompt)
    if (lines === '') return result
    return { ...result, additionalContext: [...(result?.additionalContext ?? []), lines] }
  })

  // The main loop's turn ends: what another session wrote meanwhile shows now (a subagent's end is left alone)
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await syncBoard($)
      await syncList($)
    }
    return result
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
    const { attached, cards } = await shownBoard($)
    const data = {
      attached,
      cards,
      boards: boardsOf((await $.state.get(BOARDS)).value, await ownPart($, (me) => me, '')),
      root: await rootForDrawing($),
      view,
      folds: await ownPart($, (me) => foldsOf(view.folds, me), {}),
      filter: await ownPart($, (me) => filterOf(view.filter, me), ''),
      order: await ownPart($, (me) => orderOf(view.order, me), 'added'),
      now: await nowOf($),
      palette,
      shapes,
      marks: await marksNow($),
      staleHours,
    }
    const actions = {
      attach: (id) => attachFromPane($, id),
      peek: (id) => peek($, id),
      group: (name, open) => showGroup($, name, open),
      toggleShown: () => toggleShown($),
      reload: () => reloadNow($),
      renameOpen: () => renameOpen($),
      renameCancel: () => patchView($, { rename: false }),
      rename: (value) => renameFromPane($, value),
      fold: (id, open, rev, ids) => setFold($, id, open, rev, ids),
      filter: (text) => setFilter($, text),
      clearFilter: () => clearFilter($),
      order: (by) => setOrder($, by),
    }
    return guard.done(drawPane(ui, data, { surface: e.surface, columns: widthOf(e) }, actions))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const { attached, cards } = await shownBoard($)
    const isAttached = attached.board !== null
    const ui = $.ui.resolve(e)
    const card = bandTitle && isAttached ? bandCard(cards) : null
    const marks = await marksNow($)
    const changed = markedCount(marks, cards)
    // Worked out at each drawing, no timer: a card turns stale at the next redraw
    const stale = staleCount(cards, await nowOf($), staleHours, marks)
    const count = isAttached ? cards.length : null
    const mine = drawBand(ui, e.surface, widthOf(e), count, isAttached ? '' : 'ボードを選ぶ', () => openPane($), { card, palette, changed, stale, shapes })
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
