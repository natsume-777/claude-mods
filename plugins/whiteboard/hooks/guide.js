// The guide that tells a Claude in a fresh session the board exists (pure: no $ here; register.js
// hooks it up).
//
// short  one fixed section added to the system prompt (prompt.compose). The text never holds a
//        card, a count, a time or anything else of the session, so the prompt cache is not
//        spent: it is the same string on every call.
// full   short, plus a few lines on which tool to use for what, handed to the model with the
//        person's message (additionalContext of the classic UserPromptSubmit; the message
//        itself is not touched) on a turn whose message holds one of the keywords, and at
//        most once in GUIDE_EVERY turns.
// off    nothing added.
//
// The person sees the board as 「ホワイトボード」 (board.js BOARD_NAME); the texts say ボード, which
// that name holds, and the keyword ボード matches it too (keywords match as parts of the message).

/** The id of the system prompt section. */
export const GUIDE_ID = 'whiteboard:guide'

/** The section's text: fixed. Keep it to a sentence or two. */
export const GUIDE_SHORT =
  '作業ボード（mcp__whiteboard__*）があります。流れる手順・URL・状況はカードに残し、読むなら list_cards を titles_only か query で。使い方は ToolSearch で whiteboard を引く。'

/** The few lines of `full`: which tool for what, and how to pin. Fixed too. */
export const GUIDE_FULL =
  'ボードの使い分け: 全文を書き直すのは set_card。一部だけ変えるときは edit_card（本文中の find を replace に置き換える。一致が 1 箇所のときだけ）、末尾に足すだけなら append_card。' +
  '読むときは list_cards を titles_only か query で呼び、必要なカードだけ id で読む。' +
  '人が常に見ていたいカード（今の手順の全体像、URL の一覧）だけ pin: true にし、使いすぎない。済んだカードは remove_card で消す。'

/** The most turns `full` waits before it adds the lines again: once in this many. */
export const GUIDE_EVERY = 5

export const GUIDE_MODES = ['off', 'short', 'full']

/** The setting `guide`: one of the three; anything else is `short`. */
export const guideModeOf = (options) => (GUIDE_MODES.includes(options?.guide) ? options.guide : 'short')

/** The setting `guideKeywords`, "a,b" (a full-width comma or 、 splits too): the words, blanks dropped, lower-cased. */
export function keywordsOf(options) {
  const raw = typeof options?.guideKeywords === 'string' ? options.guideKeywords : 'ボード,whiteboard'
  return raw
    .split(/[,，、]/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w !== '')
}

/** The section, built afresh (the same text every time). */
export const guideSection = () => ({ id: GUIDE_ID, text: GUIDE_SHORT, scope: 'session' })

/**
 * Appends the section to the end of `result.sections` (the list `next(e)` answered); the list
 * is left alone when the mode is off, the prompt is the one-line `bare` one, or the section is
 * already there.
 */
export function withGuide(result, traits, mode) {
  const sections = Array.isArray(result?.sections) ? result.sections : null
  if (mode === 'off' || sections === null) return result
  if (Array.isArray(traits) && traits.includes('bare')) return result
  if (sections.some((s) => s?.id === GUIDE_ID)) return result
  return { ...result, sections: [...sections, guideSection()] }
}

/**
 * The turns' counter of `full`. `next(prompt)` is called for each message the person sends and
 * answers the lines to hand over, or '' for none: the message must hold a keyword (any case),
 * and the lines must not have been given in the last GUIDE_EVERY - 1 turns before it.
 */
export function makeGuideTurns(keywords) {
  const lines = GUIDE_FULL
  let turn = 0
  let last = null
  return (prompt) => {
    turn++
    const text = typeof prompt === 'string' ? prompt.toLowerCase() : ''
    if (!keywords.some((w) => text.includes(w))) return ''
    if (last !== null && turn - last < GUIDE_EVERY) return ''
    last = turn
    return lines
  }
}
