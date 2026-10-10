// The seven tools Claude calls (toolsFor, TOOLS): what each is told, its input, whether it writes,
// and what it does to the cards (board.js). How a call runs against the store is register.js's (pure)

import { LIMITS, applySet, applyEdit, applyAppend, applyRemove, applyClear, applyList, applyUndo, REMOVED_KEEP } from './board.js'
import { STYLE_INPUTS } from './style.js'

// The `style` input of set_card and edit_card: a plain string checked in board.js (no enum), so
// the names listed here are the only ones Claude is told of
const STYLE_DESCRIPTION = `カードの色: ${STYLE_INPUTS.join(' / ')}。none で色を外す。省略すると今のまま。色の名前だけで、色コードは使えない`

/**
 * The tools for a card limit (the setting `maxCards`, board.js maxCardsOf): the descriptions name
 * it, and the calls that add a card are refused beyond it (the call's context carries it, register.js).
 * With the default limit the descriptions are the same text as before the setting existed.
 */
export const toolsFor = (maxCards = LIMITS.cards) => ({
  set_card: {
    description:
      'ボード（人が画面の右のパネルで見る作業メモ）に、カードを追加するか上書きする。会話のログに埋もれて流れてしまう情報を残すために使う: ' +
      '進行中の手順やチェックリスト、並行して動かしている処理の状況、このセッションに関わる URL、決めたこと。' +
      '同じ id のカードは上書きされ（位置は変わらない）、状況が変わったら同じ id で更新する。1 カード 1 話題にして、本文は要点だけにする。' +
      '本文の一部だけを変えるときは、全文を書き直さず edit_card（一部の置き換え）か append_card（末尾に足す）を使う。' +
      '用が済んだカードは remove_card で消す。会話にもう書いたことを、ただ写すためには使わない。' +
      'body は Markdown。```mermaid の基本的な flowchart / graph（subgraph の枠も。ただし subgraph 自体へ矢印を引くと図にならない）と、参加者と矢印だけの sequenceDiagram は図になる。それ以外の図（mermaid の別の種類、ASCII など）は、コードブロックとして読める形で表示される（描画はされない）。' +
      '関係や流れは、箇条書きや表でも伝わる。' +
      'pin: true は、人が常に見ていたいカード（今の手順の全体像、URL の一覧など）に使う。使いすぎない。固定したカードは一覧の上に並ぶ。' +
      'style はカードの色（枠と見出し）。色に決まった意味はない。人に色を頼まれたときか、同じ話題のカードを同じ色にそろえるときだけ付ける。' +
      `上限: ${maxCards} 枚、title ${LIMITS.title} 文字、body ${LIMITS.body} 文字、id は英数字と _ - の ${LIMITS.id} 文字まで。` +
      '会話の圧縮などで内容を思い出せないときは list_cards で読み返す。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: `カードの名前。短い英数字と _ -（例: plan, urls, jobs）。${LIMITS.id} 文字まで` },
        title: { type: 'string', description: `カードの見出し。${LIMITS.title} 文字まで` },
        body: { type: 'string', description: `本文（Markdown）。${LIMITS.body} 文字まで。空でもよい` },
        pin: { type: 'boolean', description: 'true で先頭に固定、false で固定を外す。省略すると今のまま（新しいカードは固定なし）' },
        style: { type: 'string', description: STYLE_DESCRIPTION },
      },
      required: ['id', 'title', 'body'],
    },
    writes: true,
    apply: (cards, e, now, context) => applySet(cards, e, now, context),
  },
  edit_card: {
    description:
      'ボードのカードの本文の一部だけを書き換える。「手順の 1 項目を済みにする」「リンクの 1 つを直す」のように、数行しか変えないときに使う（全文を書き直すより軽い）。' +
      'find（本文の中にある文字列。改行を含んでよい）を replace に置き換える。find は、本文の中にちょうど 1 箇所だけ一致する長さにする' +
      '（0 箇所なら見つからなかった、2 箇所以上なら曖昧だとして断られる）。同じ文字列をすべて置き換えるなら all: true。replace を空にすると find の部分を消す。' +
      'title、固定、カードの位置は変わらない。カードが無ければ set_card で作る。全体を書き直すときは set_card。' +
      `置き換えたあとの本文が ${LIMITS.body} 文字を超える場合も断られる。` +
      '色だけを変えるときは id と style だけを渡す（find と replace は要らない、本文を送り直さない）。find も style もない呼び出しは断られる。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '書き換えるカードの id' },
        find: { type: 'string', description: '本文の中で置き換える文字列（空でない、改行を含んでよい）。1 箇所だけに一致する長さにする。style だけを変えるときは省く' },
        replace: { type: 'string', description: '置き換える文字列。空にすると find の部分を消す。find があるときは必須' },
        all: { type: 'boolean', description: 'true で、find に一致する箇所をすべて置き換える。省略すると、一致が 1 箇所のときだけ置き換える' },
        style: { type: 'string', description: STYLE_DESCRIPTION },
      },
      required: ['id'],
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
      '会話の圧縮のあとなどに、何を書いたか思い出すためにも使う。固定したカードが先に並び、固定のカードには pinned: true が付く。色のあるカードには style が付く。' +
      'id が最優先で、あれば他は無視する（そのカード 1 枚の id・title・body）。' +
      'query は空白で分けた語をすべて含むカードを返す（id・title・body のどれか、大文字小文字は区別せず、日本語は部分一致）。各カードに、一致した行の番号（本文の 1 始まり。title か id だけの一致は 0）と、その行の先頭 120 文字を最大 5 件付ける。titles_only も一緒にあれば、その一致の行は付けず title だけにする。' +
      '結果の 1 行目は rev: N（ボードの版。書き換えのたびに増える）。読んだ rev を覚えておき、次は since にその rev を渡すと、その後に書き換えられたカードだけと、今ある全カードの ids が返る（ids に無いカードは消された）。全部を読み直さずに済む。' +
      'since は titles_only・query と組み合わせられる（変わったカードの中だけ）。会話の圧縮のあとや rev が分からないときは、titles_only から読む。' +
      'others: true は、同じ場所（フルパス）のプロジェクトの前のセッションのボードを読む（読むだけで、書き換えはできない。場所を記録する前の版で書かれたボードは読めない）。利用者が「前のセッションで書いた URL はどこ？」のように尋ねたときに使う。' +
      '新しい順に最大 5 件で、各ボードの見出し行（board: と ID の 8 文字、日時、フォルダ、枚数、題か最初の依頼、引き継ぎ済みならその印）の下に、カードの id・title・chars が並ぶ。' +
      'query と一緒なら、それらのボードのカードを同じ規則で探す（一致したボードを新しい順に 5 件）。1 枚を全文で読むときは id と board（見出しの 8 文字）を渡す。others では since は使われない。' +
      '結果は 6000 文字までで、超えると切ってその旨を書く。設定 handover がオフなら断られる。前のボードのカードをこのボードに持ってくるのは、利用者がパネルの [引き継ぐ] で行う。',
    inputSchema: {
      type: 'object',
      properties: {
        titles_only: {
          type: 'boolean',
          description:
            'true で各カードの id・title・chars（本文の文字数）だけを返す。本文に - [ ] / - [x] のチェックリストがあるカードには tasks（済んだ数/全体、例 "3/5"）も付く。' +
            'しばらく書き換えのない固定でないカードには stale: true が付く（消すかどうかは利用者に確かめる）。目次として軽く読む',
        },
        id: { type: 'string', description: 'このカード 1 枚の id・title・body だけを返す' },
        query: { type: 'string', description: '検索語。空白で分けた語をすべて含むカードを返す（大文字小文字は区別しない、日本語は部分一致）' },
        since: { type: 'integer', description: '前に読んだときの rev。それより後に書き換えられたカードだけと、今ある全カードの ids を返す。others では使われない' },
        others: { type: 'boolean', description: 'true で、このセッションではなく、同じ場所（フルパス）のプロジェクトの前のセッションのボードを読む（読むだけ）。titles_only・query・id と組み合わせられる' },
        board: { type: 'string', description: 'others で読むボード: 見出しの board: の 8 文字。id で 1 枚を読むときは必須' },
      },
    },
    writes: false,
    apply: (cards, e, _now, context) => applyList(cards, e, context),
  },
  undo_card: {
    description:
      'ボードのカードの最後の書き換えを 1 つ戻す。利用者に「さっきの書き換えを戻して」と頼まれたときや、自分がカードを間違えて上書き・編集したと気づいたときに使う。' +
      'set_card・edit_card・append_card（固定や色の変更も）で書き換えたカードは、title・body・固定・色が 1 つ前の版に戻る（カードの位置は変わらない）。' +
      '戻せるのは 1 段だけで、続けてもう一度呼ぶと、戻す前の版にやり直す。' +
      `remove_card や clear で消したカードも、最近消した ${REMOVED_KEEP} 枚まで戻せる（clear で消したときは、最後に書いたものから ${REMOVED_KEEP} 枚）。戻したカードは末尾に並び、戻した直後にもう一度呼ぶと、また消す（やり直し）。` +
      `カードが ${maxCards} 枚あるときは、消したカードは戻せない。`,
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '戻すカードの id' } }, required: ['id'] },
    writes: true,
    apply: (cards, e, now, context) => applyUndo(cards, e, now, context),
  },
})

/** The tools with the default card limit. */
export const TOOLS = toolsFor()
