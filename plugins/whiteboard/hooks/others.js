// list_cards with `others: true`: the boards earlier sessions of the same project left in $.store,
// read for Claude (pure: no $ here; register.js reads the store and hands its values in).
//
// Reading only: nothing here is written back, nothing is marked or sealed, and this session's own
// board (its cards, its revision) is not read at all. Which boards count: those whose meta keeps
// the same hash of the session root's full path as this session's (`rootHash`, boards.js
// rootHashOf), so two projects in folders of the same name are told apart. A board whose meta has
// no hash (one written before it was kept) is never shown. Unlike the hand-over list (boards.js
// candidatesOf, which goes by the folder name), boards of other projects are left out altogether,
// and a sealed board is shown too, with a mark: the list leaves a sealed board out so that it is
// not copied twice, which does not apply to reading it. An empty board is left out, as there.

import { boardCardsOf, orderedCards, queryTerms, searchCards } from './board.js'
import { sessionOfKey, metaKey, sealKey, summarizeBoard, fullStampOf, stampOf, UNKNOWN_FOLDER } from './boards.js'

/** What one answer holds at most: the boards shown, and its characters in all. */
export const OTHERS_LIMITS = { boards: 5, chars: 6000 }

/** What list_cards answers with `others` while the setting `handover` is off. */
export const OTHERS_OFF = '設定 handover がオフなので、前のセッションのボードは読めません（others は使えません）。読みたいときは、利用者に設定 handover をオンにしてもらってください'

const byNewest = (a, b) => (b.row.updatedAt ?? -Infinity) - (a.row.updatedAt ?? -Infinity)

/**
 * The other sessions' boards of this project, newest first (one with no time last), from the
 * store's `keys` and a Map of their `values`: [{ row (boards.js summarizeBoard), cards (in the
 * pane's order, the pinned first) }]. Not the session `me`, not an empty board, only those whose
 * meta keeps `rootHash` (none when that is not known).
 */
export function projectBoards(me, rootHash, keys, values) {
  if (typeof rootHash !== 'string' || rootHash === '') return []
  const out = []
  for (const key of keys) {
    const sid = sessionOfKey(key)
    if (sid === null || sid === me) continue
    const row = summarizeBoard(sid, values.get(key), values.get(metaKey(sid)), values.get(sealKey(sid)))
    if (row.count === 0 || row.rootHash !== rootHash) continue
    out.push({ row, cards: orderedCards(boardCardsOf(values.get(key))) })
  }
  return out.sort(byNewest)
}

/** A board's header line: its id for `board`, when and where it was written, its cards, what it began with, its seal. */
export function boardHeader(row, me) {
  const parts = [
    `board: ${row.sid8}`,
    typeof row.updatedAt === 'number' ? fullStampOf(row.updatedAt) : '時刻不明',
    row.cwdName,
    `${row.count} 枚`,
  ]
  if (row.title) parts.push(`題「${row.title}」`)
  else if (row.firstPrompt) parts.push(`最初の依頼「${row.firstPrompt}」`)
  const s = row.handedOver
  if (s) {
    const to = s.to === me ? 'このセッション' : `別のセッション（${s.toCwdName} · ID ${s.toSid8}）`
    parts.push(`引き継ぎ済み（${stampOf(s.at)} に${to}へ。読み取り専用）`)
  }
  return parts.join(' · ')
}

/** The line put at the end of an answer cut to `max` characters. */
export const truncatedLine = (max = OTHERS_LIMITS.chars) => `（${max} 文字を超えたので、ここで切りました。query で絞るか、id と board で 1 枚ずつ読んでください）`

/**
 * The lines joined, at most `max` characters: whole lines while they fit, the first that does not
 * cut to the room left (with …), then truncatedLine.
 */
export function capText(lines, max = OTHERS_LIMITS.chars) {
  const whole = lines.join('\n')
  if (whole.length <= max) return whole
  const note = truncatedLine(max)
  const budget = max - note.length - 1
  const out = []
  let used = 0
  for (const line of lines) {
    const sep = out.length > 0 ? 1 : 0
    if (used + sep + line.length <= budget) {
      out.push(line)
      used += sep + line.length
      continue
    }
    const room = budget - used - sep - 1
    if (room > 0) {
      let part = line.slice(0, room)
      // Not half of a surrogate pair
      if (/[\uD800-\uDBFF]$/.test(part)) part = part.slice(0, -1)
      out.push(part + '…')
    }
    break
  }
  out.push(note)
  return out.join('\n')
}

const wrong = (name, type) => ({ error: `${name} は${type}で指定してください` })

/**
 * Whether a list_cards call reads the other boards: 'others' (others: true), 'own' (the board of
 * this session, as before), or { error } for an input of the wrong type or a `board` without others.
 */
export function othersMode(input = {}) {
  if (input.others !== undefined && typeof input.others !== 'boolean') return wrong('others', ' true か false')
  if (input.board !== undefined && typeof input.board !== 'string') return wrong('board', '文字列（一覧のヘッダーの board: の 8 文字）')
  if (input.others === true) return 'others'
  if (typeof input.board === 'string' && input.board.trim() !== '') return { error: 'board は others: true と一緒に指定してください（前のセッションのボードの 1 枚を読むときに使う）' }
  return 'own'
}

/**
 * The answer of list_cards with `others: true`, { text } or { error }, from projectBoards' list.
 * `since` is not read. Arguments:
 *   id + board  the card `id` of the board whose session id begins with `board`, whole
 *   board       (without id) only that board, listed or searched as below
 *   query       the cards holding every word (as list_cards' query) in all those boards; the
 *               newest OTHERS_LIMITS.boards boards with a match, each under its header
 *   (none)      the newest OTHERS_LIMITS.boards boards, each under its header, its cards as
 *               { id, title, chars }
 * `titles_only` with `query` leaves the matching lines out, as on this session's board.
 */
export function answerOthers(boards, input = {}, { me, cwdName, rootHash, max = OTHERS_LIMITS.chars } = {}) {
  if (input.id !== undefined && typeof input.id !== 'string') return wrong('id', '文字列')
  if (input.query !== undefined && typeof input.query !== 'string') return wrong('query', '文字列')
  if (input.titles_only !== undefined && typeof input.titles_only !== 'boolean') return wrong('titles_only', ' true か false')
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const prefix = typeof input.board === 'string' ? input.board.trim() : ''
  if (id !== '' && prefix === '') return { error: 'id で前のセッションのカードを読むときは、board（一覧のヘッダーの board: の 8 文字）も指定してください' }
  if (prefix !== '') {
    const hits = boards.filter((b) => b.row.sid8 === prefix || b.row.sid.startsWith(prefix))
    if (hits.length === 0) return { error: `board ${prefix} のボードは、このプロジェクトの前のセッションにありません。others: true で一覧を読み、ヘッダーの board: の 8 文字を渡してください` }
    if (hits.length > 1) return { error: `board ${prefix} に当てはまるボードが ${hits.length} 件あります。ヘッダーの board: の 8 文字をそのまま渡してください` }
    // board without id: that one board, as the list or the search below shows it
    if (id === '') return answerOthers(hits, { ...input, board: undefined }, { me, cwdName, rootHash, max })
  }
  if (id !== '') {
    const { row, cards } = boards.find((b) => b.row.sid8 === prefix || b.row.sid.startsWith(prefix))
    const card = cards.find((c) => c.id === id)
    const head = boardHeader(row, me)
    if (!card) return { text: capText([head, `${id} というカードはありません（このボードの id: ${cards.map((c) => c.id).join(', ')}）`], max) }
    return { text: capText([head, JSON.stringify({ id: card.id, title: card.title, body: card.body, ...(card.pinned === true ? { pinned: true } : {}) })], max) }
  }
  if (typeof rootHash !== 'string' || rootHash === '') return { text: 'このセッションのフォルダが分からないので、同じプロジェクトの前のセッションのボードを選べません' }
  // The folder's name, for the words only (the boards are chosen by the full path's hash)
  const where = typeof cwdName === 'string' && cwdName !== '' ? cwdName : UNKNOWN_FOLDER
  if (boards.length === 0) return { text: `このプロジェクト（${where}）の前のセッションのボードはありません（同じ場所（フルパス）のプロジェクトのボードだけを読みます。場所を記録する前の版で書かれたボードは読めません）` }
  const terms = queryTerms(input.query)
  if (terms.length > 0) {
    const found = boards.map((b) => ({ ...b, rows: searchCards(b.cards, terms, input.titles_only === true) })).filter((b) => b.rows.length > 0)
    if (found.length === 0) return { text: `見つかりませんでした（このプロジェクト（${where}）の前のセッションのボード ${boards.length} 件の中）: ${terms.join(' ')}` }
    const shown = found.slice(0, OTHERS_LIMITS.boards)
    const lines = [`前のセッションのボードの検索（${where}。一致した ${found.length} 件のうち新しい ${shown.length} 件。読むだけで、書き換えはできない）`]
    for (const b of shown) lines.push(boardHeader(b.row, me), JSON.stringify(b.rows))
    if (found.length > shown.length) lines.push(`ほか ${found.length - shown.length} 件の古いボードにも一致があります`)
    return { text: capText(lines, max) }
  }
  const shown = boards.slice(0, OTHERS_LIMITS.boards)
  const lines = [`前のセッションのボード（${where}。全 ${boards.length} 件のうち新しい ${shown.length} 件。読むだけで、書き換えはできない）`]
  for (const b of shown) lines.push(boardHeader(b.row, me), JSON.stringify(b.cards.map((c) => ({ id: c.id, title: c.title, chars: c.body.length }))))
  if (boards.length > shown.length) lines.push(`ほか ${boards.length - shown.length} 件の古いボードは省きました（query で探すと、それらの中も探します）`)
  return { text: capText(lines, max) }
}
