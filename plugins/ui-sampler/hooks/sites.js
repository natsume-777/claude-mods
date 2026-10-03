// The list of every place this mod draws or calls, what the per-site on/off switches mean, and the
// call counts the pane shows. Each SITES entry's `id` is also the `[id]` label its output
// starts with and the label in the heading comment above its code, so grepping `[Spinner]`
// finds the entry, the hook and the text on screen.

export const PANE = 'ui-sampler'
export const ELEMENTS_PANE = 'ui-sampler-elements'
export const DIALOG_PANE = 'ui-sampler-dialog'
export const COMMAND = 'ui-sampler'
export const DIALOG_COMMAND = 'ui-sampler-dialog'

/**
 * What every entry point passes to $.ui.open for [DialogPane]: the main pane's button, the
 * [AbovePrompt] band's button and /ui-sampler-dialog open it the same way, so only where the
 * open came from differs. The type declarations offer no option that picks the placement:
 * the surface seats a pane `dock` or `inline` itself (Pane props `placement`).
 */
export const DIALOG_OPEN = {
  id: DIALOG_PANE,
  title: '[DialogPane] ダイアログ風のパネル',
  focus: true,
  closeOnEscape: true,
  holdToasts: true,
  rows: 12,
}

/**
 * kind: 'render' (a ui.render site), 'api' (a $ method the pane calls), 'event' (a hook on
 * an engine event), 'element' (one sample in the element pane, elements.js; `element` names
 * the entry of the surface's element table it draws). toggleable sites can be switched off
 * from the pane; an off site's hook passes `next(e)` on unchanged, an off element sample is
 * left out of the element pane's tree. A render site's `props` names each field of its render
 * props with a short note of what it means (from the type declarations); the pane lists the
 * last props the site received against it, and `propsNote` adds a line under that list.
 */
export const SITES = [
  {
    id: 'PromptHint',
    label: '[PromptHint]',
    kind: 'render',
    where: 'プロンプト欄のすぐ下の薄いヒント行。ターミナルでは待機中に `? for shortcuts`、ターンの実行中に `esc to interrupt` が出る行',
    toggleable: true,
    defaultOn: true,
    props: {
      isDraft: 'プロンプト欄に打ちかけの文字があると true',
      isWorking: 'ターンの実行中は true',
      hint: 'エンジンが描く行の文字（1 つの文字列。書き換えると行ごと置き換わる）',
      tail: 'フックが行の後ろに足す文字。エンジンからは渡されない',
    },
  },
  {
    id: 'Spinner',
    label: '[Spinner]',
    kind: 'render',
    where: 'ターンの実行中に動く行。ターミナルでは `Sauteing… (12s, 300 tokens)` のように、動く単語・経過秒数・トークン数が並ぶ行',
    toggleable: true,
    defaultOn: true,
    props: {
      word: '動く単語。ターンごとに選ばれる（デスクトップでは今の手順の説明、なければ Working）',
      message: '状態が単語を上書きしている間、単語の代わりに出る文字。なければ null',
      suffix: '単語の直後に付く「まだ続いている」印（省略記号 1 文字）',
      mode: 'ターンが今していること: requesting / responding / thinking / tool-input / tool-use',
    },
    propsNote: '経過時間・トークン数・effort は props には入っておらず、画面の側が持っている（型定義の説明）',
  },
  {
    id: 'SessionMode',
    label: '[SessionMode]',
    kind: 'render',
    where: 'プロンプト欄のフッターの右側に薄く出るモード名（`focus`、`memory paused` など。複数あれば ` & ` でつながる）',
    toggleable: true,
    defaultOn: true,
    props: {
      modes: 'フッターに出ているモード名の並び。なければ空',
    },
  },
  {
    id: 'AbovePrompt',
    label: '[AbovePrompt]',
    kind: 'render',
    where: 'プロンプト欄のすぐ上の帯。エンジン自身は何も描かず、アンケートが出る場所。ほかの mod の帯（next(e) の結果）は消さずに、その上に 1 段足す',
    toggleable: true,
    defaultOn: true,
    props: {
      hasSurvey: 'アンケートが帯を使っている間は true（そのときは譲る）',
      isWorking: 'ターンの実行中は true',
      maxRows: '帯が使える行数',
      bodyColumns: '帯の幅（桁）',
      scroll: '背の高い中身を見せる窓（offset: 先頭の行、bodyRows: 見える行数）',
      view: '帯の上に出ている会話（agentId がなければ本体の会話）',
    },
  },
  {
    id: 'CommandOutput',
    label: '[CommandOutput]',
    kind: 'render',
    where: '/ui-sampler を実行した後、会話欄でコマンドの下に残る結果の行（コマンドが返した text が出る）',
    toggleable: true,
    defaultOn: true,
    props: {
      command: 'この行を出したコマンド名（スラッシュなし）',
      args: 'コマンドに付けた引数',
      text: '行の文字（コマンドが返した text。Markdown として描かれる）',
      isErrored: 'コマンドが失敗した行なら true',
      onScreen: '会話欄の見えている範囲にこの行のどこが入っているか。外なら null',
    },
  },
  {
    id: 'Pane',
    label: '[Pane]',
    kind: 'render',
    where: '$.ui.open で開く枠（いま見ているこのパネル）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: 'ElementsPane',
    label: '[ElementsPane]',
    kind: 'render',
    where: '2 つ目のパネル「[Pane] 部品の見本」（下のボタンで開く）。部品ごとの見本が並ぶ',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: 'DialogPane',
    label: '[DialogPane]',
    kind: 'render',
    where: '3 つ目のパネル。$.ui.open に focus / closeOnEscape / holdToasts / rows を付けて、ダイアログのように開く。開き方は 3 通り: このボタン、[AbovePrompt] の帯のボタン、/ui-sampler-dialog',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.status',
    label: '[$.ui.status]',
    kind: 'api',
    where: 'プロンプト欄の下に固定される、この mod のステータス行（mod ごとに 1 行。次の呼び出しで置き換わる）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.status/clear',
    label: '[$.ui.status/clear]',
    kind: 'api',
    where: '$.ui.status(undefined): 上のステータス行を消す',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.toast',
    label: '[$.ui.toast]',
    kind: 'api',
    where: '会話欄の右上に重なって数秒だけ出る小さな箱（mod 名付き。既定は 4 秒）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.toast/timeoutMs',
    label: '[$.ui.toast/timeoutMs]',
    kind: 'api',
    where: '$.ui.toast(text, { timeoutMs: 10000 }): 同じ箱を 10 秒出す',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.log',
    label: '[$.ui.log]',
    kind: 'api',
    where: '会話欄に挟まる薄い 1 行（モデルには送られない）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.log/debug',
    label: '[$.ui.log/debug]',
    kind: 'api',
    where: "$.ui.log(text, { to: 'debug' }): デバッグログ（claude --debug）にだけ書き、画面には何も出さない",
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.ask',
    label: '[$.ui.ask]',
    kind: 'api',
    where: 'エンジン標準の質問ダイアログ（AskUserQuestion と同じもの）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.copy',
    label: '[$.ui.copy]',
    kind: 'api',
    where: '押した画面のクリップボードに文字を入れる。結果（isCopied と、失敗ならその理由）を下に出す',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.panes',
    label: '[$.ui.panes]',
    kind: 'api',
    where: 'この mod が開いているパネルの一覧（id・title・isShown・isFocused・isPlaced）を下に出す',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.scroll',
    label: '[$.ui.scroll]',
    kind: 'api',
    where: "$.ui.scroll({ in: 'ui-sampler', to: 'start' }): このパネルをいちばん上までスクロールする",
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.focus',
    label: '[$.ui.focus]',
    kind: 'api',
    where: "$.ui.focus({ requestId: 'ui-sampler', key: 'refresh' }): このパネルのフォーカスの枠を上の「回数を更新」ボタンに移す（パネルがキー入力を持っている間だけ）",
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.session.append',
    label: '[$.session.append]',
    kind: 'api',
    where: '会話の記録に足す system 行（モデルは読まない）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: 'command.run',
    label: '[command.run]',
    kind: 'event',
    where: '/ui-sampler と /ui-sampler-dialog の実行。/ui-sampler の返した text が [CommandOutput] の行になる。/ui-sampler-dialog は [DialogPane] を開き、[command.run] で始まる text を返す（[CommandOutput] は描き替えない）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: 'Pane/Text',
    label: '[Pane/Text]',
    kind: 'element',
    element: 'Text',
    where: 'Text: color（テーマ名と色コード）/ backgroundColor / bold / dimColor / italic / underline / strikethrough / inverse / wrap / hover',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Box',
    label: '[Pane/Box]',
    kind: 'element',
    element: 'Box',
    where: 'Box: borderStyle / borderColor / borderDimColor / backgroundColor / padding / hover / hover.scope / position: absolute と display: none',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Button',
    label: '[Pane/Button]',
    kind: 'element',
    element: 'Button',
    where: 'Button: 既定 / variant / plain / hotkey / dimColor / autoFocus / role: dismiss / hover',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Button/action',
    label: '[Pane/Button/action]',
    kind: 'element',
    element: 'Button',
    where: 'Button の action（エンジンのキー操作 app:cycleDiffBase）。名前が通らないと見本ごと描かれないので別の切り替え',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Input',
    label: '[Pane/Input]',
    kind: 'element',
    element: 'Input',
    where: 'Input: label / placeholder / submitLabel / value。打った字を下に写す',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Select',
    label: '[Pane/Select]',
    kind: 'element',
    element: 'Select',
    where: 'Select: label / options（label あり・なし）/ value。選んだ値を下に写す',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Link',
    label: '[Pane/Link]',
    kind: 'element',
    element: 'Link',
    where: 'Link: 文中（children）/ label / どちらもなし（URL がそのまま出る）/ http://localhost',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Code',
    label: '[Pane/Code]',
    kind: 'element',
    element: 'Code',
    where: 'Code: language + startLine / path から言語を推測 / format: diff / wrap: truncate-end',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Markdown',
    label: '[Pane/Markdown]',
    kind: 'element',
    element: 'Markdown',
    where: 'Markdown: 見出し・表・コード・リンク / dimColor / onLinkPress + pressableLinks',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Svg',
    label: '[Pane/Svg]',
    kind: 'element',
    element: 'Svg',
    where: 'Svg: 画像として / width・height で縮める / isInteractive（:hover と動き）',
    toggleable: true,
    defaultOn: true,
  },
]

export const KIND_LABEL = { render: '描画', api: 'API', event: 'イベント', element: '部品' }

export function siteOf(id) {
  const site = SITES.find(one => one.id === id)
  if (!site) throw new Error('unknown site: ' + id)
  return site
}

// ----- Toggles: $.state, session only -----
// The engine follows $ only into functions of the same file, and reads a state reference only
// where it is written as literals in the file that uses it. So the files that draw declare
// `{ plugin: 'ui-sampler', key: 'toggles' }` (a family, one member per site id) and
// `promptHintMode` themselves and read and write them there; this file keeps the pure part.

/** What a switch's stored value means: unset is the site's default; a fixed site is always on. */
export function toggleValue(id, value) {
  const site = siteOf(id)
  if (!site.toggleable) return true
  return value ?? site.defaultOn
}

// ----- Call counts: module variables -----
// $.state.set is refused while a render hook draws, so the render hooks count here instead.
// A reload starts the counts over, which is fine for a diagnostic.

const calls = new Map()

/**
 * Counts one call of a site, with the surface it came from when there is one.
 * Returns true the first time a site or a surface is seen, so a render hook can ask for one
 * redraw of the pane without redrawing itself on every call.
 */
export function noteCall(id, surface) {
  let entry = calls.get(id)
  const isNewSite = !entry
  if (!entry) {
    entry = { count: 0, surfaces: new Set() }
    calls.set(id, entry)
  }
  entry.count += 1
  const isNewSurface = surface !== undefined && !entry.surfaces.has(surface)
  if (surface !== undefined) entry.surfaces.add(surface)
  return isNewSite || isNewSurface
}

/** The pane's line for a site's count: how many calls, and on which surfaces. */
export function callSummary(id) {
  const entry = calls.get(id)
  if (!entry) return 'まだ一度も呼ばれていない'
  const surfaces = entry.surfaces.size > 0 ? `（${[...entry.surfaces].join(', ')}）` : ''
  return `${entry.count} 回${surfaces}`
}

// ----- Last props seen: module variables -----
// What a render site last received, for the pane to list field by field. Kept here for the
// same reason as the counts: no $.state.set while drawing.

const seen = new Map()

/** Keeps a render site's latest surface and props; returns true when they changed. */
export function noteProps(id, e) {
  const snapshot = { surface: e.surface, props: e.props }
  const text = JSON.stringify(snapshot)
  if (seen.get(id)?.text === text) return false
  seen.set(id, { text, snapshot })
  return true
}

/** The last `{ surface, props }` a render site received, or undefined before its first call. */
export function lastProps(id) {
  return seen.get(id)?.snapshot
}

/** One value as the pane and the spinner line show it: strings quoted, absent said so. */
export function formatValue(value) {
  if (value === undefined) return '（なし）'
  return JSON.stringify(value)
}
