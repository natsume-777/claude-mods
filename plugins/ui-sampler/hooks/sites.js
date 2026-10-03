// The list of every place this mod draws or calls, what the per-site on/off switches mean, and the
// call counts the pane shows. Each SITES entry's `id` is also the `[id]` label its output
// starts with and the label in the heading comment above its code, so grepping `[Spinner]`
// finds the entry, the hook and the text on screen.

export const PANE = 'ui-sampler'
export const DIALOG_PANE = 'ui-sampler-dialog'
export const COMMAND = 'ui-sampler'
export const DIALOG_COMMAND = 'ui-sampler-dialog'

/**
 * What every entry point passes to $.ui.open for [DialogPane]: the dialog category's button, the
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
 * The categories the table of contents lists, in its order. Each SITES entry names one in
 * `category`. [開く] switches the one pane to the category's view (pane.js), which lists its
 * sites one line each; the element samples are a view of their own ('samples', elements.js)
 * reached from the 部品 category. A category marked `isPending` is listed as not made yet.
 */
export const CATEGORIES = [
  {
    id: 'lines',
    label: '標準の行・帯',
    about: 'エンジンが描く行（スピナー、モード表示、ヒント行、コマンドの結果）と、プロンプト欄の上の帯',
  },
  {
    id: 'transcript',
    label: '会話の行',
    about: '会話欄の利用者・Claude・ツールの行。型定義でターミナルだけとされる行は数えるだけ',
  },
  {
    id: 'dialogs',
    label: 'ダイアログ',
    about: '質問ダイアログ、許可ダイアログの下の行、ダイアログ風に開く別のパネル',
  },
  {
    id: 'api',
    label: '$.ui の API',
    about: 'ボタンで呼ぶ API（ステータス行、トースト、ログ、コピー、パネルの一覧など）と、このパネル・コマンド自体',
  },
  {
    id: 'events',
    label: 'イベント・入力欄',
    about: 'スラッシュコマンドの説明、ターンの終わり、プロンプト欄の提案と下書き。受け取った値は [詳細] に出る',
  },
  {
    id: 'elements',
    label: '部品',
    about: 'パネルに置ける部品（Text、Box、Button、Input など）の見本。ここで見本ごとにオン・オフし、[見本を見る] で並べて描く',
  },
  {
    id: 'values',
    label: '値',
    about: 'フックが受け取る値の見本（未実装）',
    isPending: true,
  },
]

/** The note under the props of a transcript row site: many rows share one site. */
const ROW_PROPS_NOTE =
  '会話欄に何行あっても、ここに出るのは最後に描かれた 1 行の props。行が描き直されてもこのパネルは描き直さないので、「回数を更新」で最新にする。呼び出しの回数には描き直しも入る'

/**
 * kind: 'render' (a ui.render site), 'api' (a $ method the pane or a hook calls), 'event' (a
 * hook on an engine event), 'element' (one sample in the samples view, elements.js; `element`
 * names the entry of the surface's element table it draws). category: its CATEGORIES id.
 * toggleable sites can be switched off from the pane; an off site's hook passes `next(e)` on
 * unchanged, an off element sample is left out of the samples view's tree. A render site's
 * `props` names each field of its render props with a short note of what it means (from the
 * type declarations); the pane lists the last props the site received against it, and
 * `propsNote` adds a line under that list. An event site's `props` does the same for the
 * fields of its input `e`.
 */
export const SITES = [
  {
    id: 'PromptHint',
    label: '[PromptHint]',
    kind: 'render',
    category: 'lines',
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
    category: 'lines',
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
    category: 'lines',
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
    category: 'lines',
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
    category: 'lines',
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
    category: 'api',
    where: '$.ui.open で開く枠。/ui-sampler で開くこのパネル「[Pane] UI 見本市」。目次・分類ごとの一覧・部品の見本を、同じパネルの中で切り替えて描く。/ui-sampler で開き直すと目次に戻る',
    toggleable: false,
    defaultOn: true,
  },


  {
    id: 'DialogPane',
    label: '[DialogPane]',
    kind: 'render',
    category: 'dialogs',
    where: '$.ui.open に focus / closeOnEscape / holdToasts / rows を付けて、ダイアログのように開くパネル。開き方は 3 通り: この行のボタン、[AbovePrompt] の帯のボタン、/ui-sampler-dialog',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.status',
    label: '[$.ui.status]',
    kind: 'api',
    category: 'api',
    where: 'プロンプト欄の下に固定される、この mod のステータス行（mod ごとに 1 行。次の呼び出しで置き換わる）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.status/clear',
    label: '[$.ui.status/clear]',
    kind: 'api',
    category: 'api',
    where: '$.ui.status(undefined): 上のステータス行を消す',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.toast',
    label: '[$.ui.toast]',
    kind: 'api',
    category: 'api',
    where: '会話欄の右上に重なって数秒だけ出る小さな箱（mod 名付き。既定は 4 秒）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.toast/timeoutMs',
    label: '[$.ui.toast/timeoutMs]',
    kind: 'api',
    category: 'api',
    where: '$.ui.toast(text, { timeoutMs: 10000 }): 同じ箱を 10 秒出す',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.log',
    label: '[$.ui.log]',
    kind: 'api',
    category: 'api',
    where: '会話欄に挟まる薄い 1 行（モデルには送られない）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.log/debug',
    label: '[$.ui.log/debug]',
    kind: 'api',
    category: 'api',
    where: "$.ui.log(text, { to: 'debug' }): デバッグログ（claude --debug）にだけ書き、画面には何も出さない",
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.ask',
    label: '[$.ui.ask]',
    kind: 'api',
    category: 'dialogs',
    where: 'エンジン標準の質問ダイアログ（AskUserQuestion と同じもの）。[AskUserQuestion] をオンにしてから押すと、その描き替えも試せる',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.copy',
    label: '[$.ui.copy]',
    kind: 'api',
    category: 'api',
    where: '押した画面のクリップボードに文字を入れる。結果（isCopied と、失敗ならその理由）を下に出す',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.panes',
    label: '[$.ui.panes]',
    kind: 'api',
    category: 'api',
    where: 'この mod が開いているパネルの一覧（id・title・isShown・isFocused・isPlaced）を下に出す',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.scroll',
    label: '[$.ui.scroll]',
    kind: 'api',
    category: 'api',
    where: "$.ui.scroll({ in: 'ui-sampler', to: 'start' }): このパネルをいちばん上までスクロールする",
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.focus',
    label: '[$.ui.focus]',
    kind: 'api',
    category: 'api',
    where: "$.ui.focus({ requestId: 'ui-sampler', key: 'refresh' }): このパネルのフォーカスの枠を上の「回数を更新」ボタンに移す（パネルがキー入力を持っている間だけ）",
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.session.append',
    label: '[$.session.append]',
    kind: 'api',
    category: 'api',
    where: '会話の記録に足す system 行（モデルは読まない）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: 'command.run',
    label: '[command.run]',
    kind: 'event',
    category: 'api',
    where: '/ui-sampler と /ui-sampler-dialog の実行。/ui-sampler の返した text が [CommandOutput] の行になる。/ui-sampler-dialog は [DialogPane] を開き、[command.run] で始まる text を返す（[CommandOutput] は描き替えない）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: 'UserMessage',
    label: '[UserMessage]',
    kind: 'render',
    category: 'transcript',
    where: '会話欄の利用者側の行。ターミナルでは `> ` で始まる、打ったプロンプトの行。バックグラウンドのタスクの通知や、ほかのエージェント・セッションから届いたメッセージの行もここ。オンにすると、エンジンの行はそのままで、その上に [UserMessage] の 1 行を足す',
    toggleable: true,
    defaultOn: false,
    props: {
      text: '行に出る文字（打ったプロンプト、通知の要約、届いたメッセージの本文）',
      origin: 'メッセージの出どころ（kind: プロンプト欄、タスクの通知、ほかのセッション、プラグインなど）。読み取り専用',
      isExpanded: '行を全部出しているか（ctrl+o の記録表示など）。false なら送り主の名前だけの薄い 1 行になることがある',
      task: '通知の行のときだけ: そのバックグラウンドのタスク（id、status、durationMs）',
      from: 'ほかのエージェント・チームメイト・セッションから届いた行のときだけ: 送り主',
      onScreen: '会話欄の見えている範囲にこの行のどこが入っているか。外なら null、画面が知らせないときはなし',
    },
    propsNote: ROW_PROPS_NOTE,
  },
  {
    id: 'AssistantMessage',
    label: '[AssistantMessage]',
    kind: 'render',
    category: 'transcript',
    where: 'Claude の返答の文章。返答の text ブロック 1 つが 1 行で、ターミナルでは返答の最初のブロックの頭に ● が付く。オンにすると、ブロックごとにその上に [AssistantMessage] の 1 行を足す',
    toggleable: true,
    defaultOn: false,
    props: {
      text: 'ブロックの文字（Markdown）。画面が隠す部分は除かれている',
      isFirstOfReply: '返答の最初のブロック（頭の印を描くもの）なら true',
      onScreen: '会話欄の見えている範囲にこの行のどこが入っているか。外なら null、画面が知らせないときはなし',
    },
    propsNote: ROW_PROPS_NOTE,
  },
  {
    id: 'ToolUse',
    label: '[ToolUse]',
    kind: 'render',
    category: 'transcript',
    where: 'ツールの呼び出しの行。ターミナルでは `● Bash(ls -la)` のように、ツール名と入力が出る行。オンにすると、その上に [ToolUse] の 1 行を足す',
    toggleable: true,
    defaultOn: false,
    props: {
      tool_use_id: 'この呼び出しの id（tool.call の e.tool_use_id と同じ）。読み取り専用',
      tool: 'ツール名（Bash、Read、プラグインのツールなど）',
      input: 'モデルが送った入力',
      isRunning: 'まだ実行中なら true',
      isErrored: 'エラーで終わったら true（許可ダイアログで断ったときも）',
      isInterrupted: 'Esc などの中断で終わったら true',
      output: '終わった後の結果（Bash なら stdout・stderr など）。実行中はなし',
      onScreen: '会話欄の見えている範囲にこの行のどこが入っているか。外なら null、画面が知らせないときはなし',
    },
    propsNote: ROW_PROPS_NOTE,
  },
  {
    id: 'ToolResult',
    label: '[ToolResult]',
    kind: 'render',
    category: 'transcript',
    where: 'ツールの呼び出しの行の下に出る結果。ターミナルでは `⎿` に続くコマンドの出力など。まとめられていない単独の呼び出しの行だけ。オンにすると、その上に [ToolResult] の 1 行を足す',
    toggleable: true,
    defaultOn: false,
    props: {
      tool_use_id: 'この結果の呼び出しの id。読み取り専用',
      tool: 'ツール名。読み取り専用',
      output: 'ツールの結果そのもの（ToolUse の output と同じもの）',
      isErrored: 'エラーで終わったら true（そのときは output ではなくエラーの文字が出る）。読み取り専用',
      onScreen: '会話欄の見えている範囲にこの行のどこが入っているか。外なら null、画面が知らせないときはなし',
    },
    propsNote: ROW_PROPS_NOTE,
  },
  {
    id: 'ToolGroup',
    label: '[ToolGroup]',
    kind: 'render',
    category: 'transcript',
    where: '続けて呼ばれた読み取り・検索などのツールを 1 行にまとめた行。ターミナルでは `Read 3 files, ran 2 shell commands` のような行。オンにすると、その上に [ToolGroup] の 1 行を足す',
    toggleable: true,
    defaultOn: false,
    props: {
      calls: 'まとめた呼び出しの並び（呼ばれた順。1 件ずつ tool・input・isRunning・output など）',
      isActive: 'まだ続きが加わりうる、いま動いているまとまりなら true',
      isExpanded: '呼び出しごとの [ToolUse] の行に開いて出すなら true、1 行にまとめるなら false。書き換えて画面が変わるのはこれだけ',
      onScreen: '会話欄の見えている範囲にこの行のどこが入っているか。外なら null、画面が知らせないときはなし',
    },
    propsNote: ROW_PROPS_NOTE,
  },
  {
    id: 'ToolGroup/isExpanded',
    label: '[ToolGroup/isExpanded]',
    kind: 'render',
    category: 'transcript',
    where: '[ToolGroup] のまとめた行で、isExpanded を true にして next(e) に渡し、呼び出しごとの行に開く。開いたことは [ToolGroup/isExpanded] の 1 行で示す。開いた行は [ToolUse] の行なので、[ToolUse] もオンにすると印が付く',
    toggleable: true,
    defaultOn: false,
  },
  {
    id: 'AskUserQuestion',
    label: '[AskUserQuestion]',
    kind: 'render',
    category: 'dialogs',
    where: 'Claude が AskUserQuestion ツールで出す質問ダイアログ（[$.ui.ask] のボタンでも出る）。オンにすると、質問文の頭に [AskUserQuestion] を付けて next(e) に渡す（見出しの header は 12 文字までなので使わない）',
    toggleable: true,
    defaultOn: false,
    props: {
      tool: 'ダイアログを開いたツールの名前（AskUserQuestion）',
      questions: 'ツールの questions 入力（question・header・options・multiSelect）。書き換えてもツールの形に合わないと元のまま出る',
      metadataSource: '誰が聞いたか（モデルが付けたときだけ）。集計用で、画面には出ない',
    },
  },
  {
    id: '$.ui.notice',
    label: '[$.ui.notice]',
    kind: 'api',
    category: 'dialogs',
    where: 'Bash の許可ダイアログの下に足す 1 行。オンにすると、tool.call（Bash）のフックが next(e) の前に $.ui.notice(e.tool_use_id, text) を呼ぶ。行は呼び出しが終わるとエンジンが消す。許可ダイアログが出ない Bash（許可済みのコマンドなど）では、出る場所がない',
    toggleable: true,
    defaultOn: false,
  },
  {
    id: 'ToolProgress',
    label: '[ToolProgress]',
    kind: 'render',
    category: 'transcript',
    where: 'ターミナルで、実行中のツールの行の下に薄く出る `(ctrl+b to run in background)` の行。呼ばれた回数と props を記録するだけで、描画は変えない',
    toggleable: false,
    defaultOn: true,
    props: {
      tool_use_id: 'この行が属するツールの呼び出しの id。読み取り専用',
      kind: '進み具合の行の種類（いまは background_hint だけ）。読み取り専用',
      hint: 'エンジンが描く文字（`(ctrl+b to run in background)` など）',
    },
  },
  {
    id: 'TurnDuration',
    label: '[TurnDuration]',
    kind: 'render',
    category: 'transcript',
    where: 'ターミナルで、ターンの終わりに会話欄へ残る `Baked for 3s` の行。呼ばれた回数と props を記録するだけで、描画は変えない',
    toggleable: false,
    defaultOn: true,
    props: {
      word: '行の過去形の単語（Baked など）',
      durationMs: 'ターンにかかった時間（ミリ秒）',
      onScreen: '会話欄の見えている範囲にこの行のどこが入っているか。外なら null、画面が知らせないときはなし',
    },
    propsNote: ROW_PROPS_NOTE,
  },
  {
    id: 'InfoNotice',
    label: '[InfoNotice]',
    kind: 'render',
    category: 'transcript',
    where: 'ターミナルの起動時に、ロゴの下に薄く出るお知らせの行（使っているモデルの出どころ、設定のヒントなど。後ろに /コマンド が付くことがある）。呼ばれた回数と props を記録するだけで、描画は変えない',
    toggleable: false,
    defaultOn: true,
    props: {
      text: 'お知らせの文字（1 つの文字列にしたもの）',
      command: '後ろに付く /コマンド。なければ null',
      onScreen: '会話欄の見えている範囲にこの行のどこが入っているか。外なら null、画面が知らせないときはなし',
    },
    propsNote: ROW_PROPS_NOTE,
  },
  {
    id: 'command.describe',
    label: '[command.describe]',
    kind: 'event',
    category: 'events',
    where: '/ を打ったときの候補と /help に出る、/ui-sampler と /ui-sampler-dialog の説明。オンにすると説明の頭に [command.describe] を付ける。答えはセッションの間覚えられるので、切り替えたときに $.ui.invalidate("command.describe") で聞き直させる',
    toggleable: true,
    defaultOn: false,
    props: {
      command: 'コマンド名（スラッシュなし）。書き換えは断られる',
      description: '候補と /help に出る 1 行の説明（登録したときのもの）',
      argumentHint: '名前の後ろに薄く出るヒント。あるときだけ',
      isHidden: '候補と /help から外すなら true（打てば実行はできる）',
      immediate: 'ターンの途中でもすぐ実行するコマンドなら true。読み取り専用',
      provider: 'コマンドを出している plugin とその層。書き換えは断られる',
    },
  },
  {
    id: 'turn.complete',
    label: '[turn.complete]',
    kind: 'event',
    category: 'events',
    where: 'ターンが終わったとき（所要時間が出るところ）。オンにすると、答えの下に [turn.complete] の 1 行を出す（返す text を答えと違うものにすると、答えの下に出る）。サブエージェントのターンには何もしない',
    toggleable: true,
    defaultOn: false,
    props: {
      answer: 'このターンの最後に見えた答えの文字（なければ空）',
      durationMs: 'ターンにかかった時間（ミリ秒）',
      isAborted: '中断で終わったら true',
      reason: '終わった理由: answer / aborted / refusal / error',
      refusal: 'reason が refusal のときだけ: API が言った断りの中身',
      turnId: 'このターンの id（turn.start・turn.step と同じ）',
      agentId: 'サブエージェントのターンのときだけ: その id',
      usage: 'このターンのトークン数（input_tokens・output_tokens・キャッシュ）と model。数えるものがなければなし',
    },
  },
  {
    id: 'prompt.suggest',
    label: '[prompt.suggest]',
    kind: 'event',
    category: 'events',
    where: 'プロンプト欄が空のときに薄く出る提案（Tab で取り込む）。エンジンのターン後の推測か、ほかの plugin の $.prompt.suggest のときに呼ばれる（この mod 自身の [$.prompt.suggest] はこのフックを通らない）。オンにすると、提案の頭に [prompt.suggest] を付ける',
    toggleable: true,
    defaultOn: false,
    props: {
      text: '提案する文字。取り込むと下書きになる',
      origin: '誰の提案か（kind: suggestion ならエンジン、plugin なら name も）。読み取り専用',
    },
  },
  {
    id: '$.prompt.suggest',
    label: '[$.prompt.suggest]',
    kind: 'api',
    category: 'events',
    where: 'プロンプト欄に薄い提案を出す（Tab で取り込める）。欄に文字があるとき、ターンの実行中は出ない（isShown: false）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.prompt.fill',
    label: '[$.prompt.fill]',
    kind: 'api',
    category: 'events',
    where: "$.prompt.fill({ text, mode: 'append' }): プロンプト欄の下書きの後ろに文字を足す。打ちかけの文字は残る。ボタンを押したときだけ呼ぶ",
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.prompt.read',
    label: '[$.prompt.read]',
    kind: 'api',
    category: 'events',
    where: 'プロンプト欄の下書きを読む。ここには文字数とカーソルの位置だけを出し、中身は出さない',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: 'Pane/Text',
    label: '[Pane/Text]',
    kind: 'element',
    category: 'elements',
    element: 'Text',
    where: 'Text: color（テーマ名と色コード）/ backgroundColor / bold / dimColor / italic / underline / strikethrough / inverse / wrap / hover',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Box',
    label: '[Pane/Box]',
    kind: 'element',
    category: 'elements',
    element: 'Box',
    where: 'Box: borderStyle / borderColor / borderDimColor / backgroundColor / padding / hover / hover.scope / position: absolute と display: none',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Button',
    label: '[Pane/Button]',
    kind: 'element',
    category: 'elements',
    element: 'Button',
    where: 'Button: 既定 / variant / plain / hotkey / dimColor / autoFocus / role: dismiss / hover',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Button/action',
    label: '[Pane/Button/action]',
    kind: 'element',
    category: 'elements',
    element: 'Button',
    where: 'Button の action（エンジンのキー操作 app:cycleDiffBase）。名前が通らないと見本ごと描かれないので別の切り替え',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Input',
    label: '[Pane/Input]',
    kind: 'element',
    category: 'elements',
    element: 'Input',
    where: 'Input: label / placeholder / submitLabel / value。打った字を下に写す',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Select',
    label: '[Pane/Select]',
    kind: 'element',
    category: 'elements',
    element: 'Select',
    where: 'Select: label / options（label あり・なし）/ value。選んだ値を下に写す',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Link',
    label: '[Pane/Link]',
    kind: 'element',
    category: 'elements',
    element: 'Link',
    where: 'Link: 文中（children）/ label / どちらもなし（URL がそのまま出る）/ http://localhost',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Code',
    label: '[Pane/Code]',
    kind: 'element',
    category: 'elements',
    element: 'Code',
    where: 'Code: language + startLine / path から言語を推測 / format: diff / wrap: truncate-end',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Markdown',
    label: '[Pane/Markdown]',
    kind: 'element',
    category: 'elements',
    element: 'Markdown',
    where: 'Markdown: 見出し・表・コード・リンク / dimColor / onLinkPress + pressableLinks',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Pane/Svg',
    label: '[Pane/Svg]',
    kind: 'element',
    category: 'elements',
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
// The pane's view (`view`) and the site each category view details (`selected`, one member per
// CATEGORIES id) are kept the same way.

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

/** The category list's short count: `3 回`, `0 回`. */
export function callCount(id) {
  return `${calls.get(id)?.count ?? 0} 回`
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

/**
 * Keeps a transcript row site's latest surface and props without comparing them: many rows
 * share one site, so "changed" would hold on nearly every call, and a row's output can be
 * large enough that serializing it on every drawing is wasted work.
 */
export function keepProps(id, e) {
  seen.set(id, { text: undefined, snapshot: { surface: e.surface, props: e.props } })
}

/**
 * Keeps an event site's latest input `e` (as the props of a surfaceless snapshot, so the pane
 * lists it the way it lists a render site's props); returns true when it changed.
 */
export function noteEvent(id, e) {
  return noteProps(id, { surface: undefined, props: e })
}

/** The last `{ surface, props }` a render site received, or undefined before its first call. */
export function lastProps(id) {
  return seen.get(id)?.snapshot
}

/** Longest value the pane shows in full; a tool's output can run to many thousand characters. */
const VALUE_LIMIT = 300

/** One value as the pane and the spinner line show it: strings quoted, absent said so. */
export function formatValue(value) {
  if (value === undefined) return '（なし）'
  const text = JSON.stringify(value)
  if (text.length <= VALUE_LIMIT) return text
  return `${text.slice(0, VALUE_LIMIT)}…（全 ${text.length} 文字）`
}

// ----- Last results: module variables -----
// The line the pane shows under a site after something ran it: a button's call, or a hook
// on an engine event ([$.ui.notice]'s tool.call). A reload starts them over.

const results = new Map()

/** Keeps the latest result line of a site. */
export function noteResult(id, text) {
  results.set(id, text)
}

/** The latest result line of a site, or undefined when nothing ran it yet. */
export function resultOf(id) {
  return results.get(id)
}
