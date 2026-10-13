// What Claude reads about the boards (pure: no $ here): the answers of open_board, list_boards and
// rename_board, and the refusal of a card tool while the session is attached to no board.

import { groupBoards, titlesLine, fullStampOf, UNKNOWN_FOLDER } from './boards.js'

/** What one list_boards answer holds at most, in characters. */
export const CATALOG_LIMITS = { chars: 6000 }

/** What a card tool answers while the session is attached to no board. */
export const NOT_ATTACHED =
  'このセッションは、まだどのボードにもつながっていません。先に open_board でボードにつないでください' +
  '（name に、作業の内容が分かる短い名前を付ける。同じ名前のボードがあればそれにつながり、無ければ作る）。' +
  'どのボードがあるかは list_boards で読めます。利用者が「◯◯のボードを使って」と言っていれば、その名前で open_board を呼びます。'

/** What a write answers when another session wrote the same board between the read and the save. */
export const CHANGED_MEANWHILE =
  'ほかのセッションが同じボードを書き換えたので、書き込みませんでした。list_cards（titles_only か、前の rev を since に渡す）で読み直してから、もう一度書いてください。'

/** The line put at the end of an answer cut to `max` characters. */
export const truncatedLine = (max = CATALOG_LIMITS.chars) => `（${max} 文字を超えたので、ここで切りました）`

/**
 * The lines joined, at most `max` characters: whole lines while they fit, the first that does not
 * cut to the room left (with …), then truncatedLine.
 */
export function capText(lines, max = CATALOG_LIMITS.chars) {
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

/** One board in list_boards: `- 「名前」 · 2026-10-13 14:05 · 5 枚 · 最後に書いたセッション: … · カード: …`, and the folder for another project's. */
export function boardLine(row, { current = null, folder = false } = {}) {
  const parts = [`- 「${row.name}」`]
  if (row.id === current) parts.push('（このセッションがつないでいる）')
  if (folder) parts.push(`フォルダ ${row.cwdName ?? UNKNOWN_FOLDER}`)
  parts.push(typeof row.updatedAt === 'number' ? fullStampOf(row.updatedAt) : '時刻不明', `${row.count} 枚`)
  if (row.lastTitle) parts.push(`最後に書いたセッション: ${row.lastTitle}`)
  parts.push(`カード: ${titlesLine(row)}`)
  return parts.join(' · ')
}

/**
 * list_boards' answer: this project's boards newest first (the one attached marked), then how many
 * the other projects and the old boards have; `all` lists those too, each with its folder.
 */
export function listBoardsText(rows, { rootHash, cwdName, current = null, all = false, max = CATALOG_LIMITS.chars } = {}) {
  const { mine, others, old } = groupBoards(rows, { rootHash })
  const where = typeof cwdName === 'string' && cwdName !== '' ? cwdName : UNKNOWN_FOLDER
  const lines = []
  if (mine.length === 0) lines.push(`このプロジェクト（${where}）のボードはまだありません。open_board に名前を渡すと作れます`)
  else {
    lines.push(`このプロジェクト（${where}）のボード（${mine.length} 件、新しい順）`)
    for (const row of mine) lines.push(boardLine(row, { current }))
  }
  if (all) {
    if (others.length > 0) {
      lines.push(`ほかのプロジェクトのボード（${others.length} 件）`)
      for (const row of others) lines.push(boardLine(row, { current, folder: true }))
    }
    if (old.length > 0) {
      lines.push(`古いボード（${old.length} 件。前の版で別のセッションに引き継がれたもの）`)
      for (const row of old) lines.push(boardLine(row, { current, folder: row.rootHash !== rootHash }))
    }
  } else if (others.length + old.length > 0) {
    lines.push(`ほかに、ほかのプロジェクトのボード ${others.length} 件と古いボード ${old.length} 件があります（all: true で一覧）`)
  }
  if (current === null) lines.push('このセッションは、まだどのボードにもつながっていません。open_board に名前を渡すと、そのボードにつながります')
  return capText(lines, max)
}

/** open_board's answer after attaching to a board that was there. */
export function attachedText(row, { created = false, project = true } = {}) {
  if (created) return `ボード「${row.name}」を作って、このセッションをつなぎました。カードは set_card で書きます`
  const when = typeof row.updatedAt === 'number' ? `、最後の書き込み ${fullStampOf(row.updatedAt)}` : ''
  const where = project ? '' : `（ほかのプロジェクト ${row.cwdName ?? UNKNOWN_FOLDER} のボード）`
  const read = row.count > 0 ? '。中身は list_cards の titles_only で読めます' : ''
  return `ボード「${row.name}」${where}につなぎました（カード ${row.count} 枚${when}）${read}`
}

/** open_board's answer when the session is attached to that board already. */
export const alreadyText = (row) => `このセッションは、すでにボード「${row.name}」につながっています（カード ${row.count} 枚）`

/** rename_board's answer. */
export const renamedText = (from, to) => (from === to ? `ボードの名前は、すでに「${to}」です` : `ボードの名前を「${from}」から「${to}」に変えました`)

/** What open_board and rename_board answer when a name of this project is taken by another board (rename only). */
export const takenText = (name) => `このプロジェクトには「${name}」という名前のボードがもうあります。別の名前にしてください（そのボードを使うなら open_board でその名前を渡す）`
