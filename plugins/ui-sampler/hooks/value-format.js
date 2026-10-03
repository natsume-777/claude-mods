// The values view's tables and formatting (view 'values', drawn by values.js): which values
// the view lists in each section, the note each one's [詳細] shows, and the pure functions
// that cut a value down to what the view may show. Values that can hold secrets (the
// settings, the environment, the prompt's text, the transcript) are reduced here to key
// names, counts and lengths before anything is kept or drawn.
//
// Pure: no $ here, so values.js keeps every $ call itself.

/** The longest string a row shows. */
export const TEXT_LIMIT = 80
/** The longest JSON a row shows for an object. */
export const JSON_LIMIT = 200
/** The longest JSON a [詳細] shows. */
export const FULL_LIMIT = 4000
/** How many names a row shows of a list. */
const NAMES_SHOWN = 3

/** How often the light getters are fetched again while the values view is shown. */
export const AUTO_REFRESH_MS = 5000

/**
 * The note under every [詳細] of the getters: what a getter answers is what the chain of
 * hooks answered, and another plugin can hook it.
 */
export const HOOK_NOTE =
  '$ の呼び出しはどれもフックの連鎖を通るので、ほかのプラグインが答えを書き換えられる。ここに出るのは、この mod に届いた答え'

/**
 * The getters fetched on opening the view and on [再取得]. `isAuto`: also fetched every
 * AUTO_REFRESH_MS while the view is shown (cheap, and may change during a session).
 * `section` is where the row is listed: 'getters' or 'stores'. values.js's getterValue()
 * makes each call, by id.
 */
export const GETTERS = [
  { id: 'plugin.name', section: 'getters', isAuto: false, note: 'plugin.json の name。$.plugin.name はプロパティで、呼び出しではない' },
  { id: 'plugin.root', section: 'getters', isAuto: false, note: 'plugin.json のあるフォルダ（絶対パス）。$.plugin.root もプロパティ' },
  { id: 'session.id', section: 'getters', isAuto: false, note: 'セッションの id（記録ファイルの名前）' },
  { id: 'session.cwd', section: 'getters', isAuto: true, note: 'セッションが動いているフォルダ（絶対パス）' },
  { id: 'session.root', section: 'getters', isAuto: true, note: 'プロジェクトのルート。/cd などで動く。シェルの cd では動かない' },
  { id: 'session.model', section: 'getters', isAuto: true, note: '本体のモデル。/model に出る名前' },
  { id: 'session.turns', section: 'getters', isAuto: true, note: 'このセッションで送ったプロンプトの数' },
  { id: 'session.version', section: 'getters', isAuto: false, note: 'エンジンの version、元のリリース base、ビルド日時 builtAt' },
  { id: 'session.surfaces', section: 'getters', isAuto: true, note: 'このセッションが描いている surface の一覧' },
  {
    id: 'session.usage',
    section: 'getters',
    isAuto: true,
    note: '引数なしの $.session.usage()。ステータス行と同じ数字（コンテキストの使用率、レート制限、費用）。費用はかからない。内訳つきは下の「ボタンで呼ぶもの」',
  },
  { id: 'tool.list', section: 'getters', isAuto: false, note: 'モデルが今呼べるツール（組み込みと MCP）。[詳細] では説明を 80 文字で切る' },
  { id: 'command.list', section: 'getters', isAuto: false, note: '今使えるスラッシュコマンド（組み込み・プラグイン・MCP）。[詳細] では説明を 80 文字で切る' },
  { id: 'agent.list', section: 'getters', isAuto: true, note: 'このセッションのサブエージェント（モデルが起こしたものも、プラグインが起こしたものも）' },
  {
    id: 'config.list',
    section: 'getters',
    isAuto: false,
    note: '/config のメニューの行。文字列の値は中身を出さず文字数だけ（プラグインの userConfig に秘密が入りうるため）',
  },
  { id: 'ui.panes', section: 'getters', isAuto: true, note: 'この mod が開いているパネル' },
  {
    id: 'clock.now',
    section: 'getters',
    isAuto: true,
    note: '取得した時刻（エポックからのミリ秒）。自動の取得では、ほかの値が変わったときだけ描き直すので、この値だけでは表示が進まない',
  },
  {
    id: 'state.get',
    section: 'stores',
    isAuto: true,
    note: 'この mod 自身の $.state（view、promptHintMode、spinnerMode、commandOutputMode）の値と version。どのプラグインもほかのプラグインの値を読めるが、書けるのは持ち主だけ',
  },
  { id: 'store.keys', section: 'stores', isAuto: true, note: 'この mod の $.store のキー。ui-sampler は $.store に書かないので、ふつうは空' },
  { id: 'store.get', section: 'stores', isAuto: true, note: '$.store の各キーの値（読むだけ。書き込みはしない）。最初の 10 キーまで' },
]

/** The getters fetched every AUTO_REFRESH_MS while the view is shown. */
export const AUTO_GETTERS = GETTERS.filter(getter => getter.isAuto).map(getter => getter.id)

/**
 * The engine events whose last input values.js keeps, in the order the view lists them. The
 * classic (settings) hook events follow, each under its own name (CLASSIC_EVENTS).
 */
export const EVENTS = [
  { id: 'session.start', note: 'セッションの開始（有効化やワーカーの再起動でも来る）。cwd、surface、isInteractive' },
  { id: 'session.end', note: 'セッションの終わり。reason、sessionId、resume' },
  { id: 'session.measure', note: 'ターンの後や、レート制限が 1 ポイント動いたときの使用量。changed が動いた項目' },
  { id: 'session.attach', note: 'surface（クライアント）がつながった' },
  { id: 'session.detach', note: 'surface（クライアント）が離れた' },
  { id: 'session.receive', note: 'ほかから届いたメッセージ。本文は文字数だけ' },
  { id: 'session.compact', note: '会話の圧縮。メッセージは数だけ、instructions は文字数だけ' },
  { id: 'prompt.submit', note: '送られたプロンプト。本文は文字数だけ、添付と context は数だけ' },
  { id: 'turn.start', note: 'ターンの始まり。本文は文字数だけ' },
  {
    id: 'turn.step',
    note: 'モデルへの 1 回の要求（ストリーム）。入力は turnId、index、model、effort、messageCount。結果は stopReason、ツール呼び出しの数、回答の文字数、usage',
  },
  { id: 'turn.complete', note: 'ターンの終わり。回答は文字数だけ。usage はトークン数' },
  { id: 'tool.call', note: 'ツールの呼び出し。入力はキー名だけ。結果は deny か、isError と text の文字数' },
  { id: 'plugin.register', note: 'プラグインの読み込み（最後の 1 つ）。uses はキー名だけ' },
]

/**
 * Every classic hook event of the type declarations (ClassicHookEvent, 2.1.286), so the view
 * can say which never arrived. One `classic.*` hook keeps them all.
 */
export const CLASSIC_EVENTS = [
  'SessionStart',
  'Setup',
  'SessionEnd',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'MessageDisplay',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'ConfigChange',
  'CwdChanged',
  'DirectoryAdded',
  'FileChanged',
  'InstructionsLoaded',
  'Elicitation',
  'ElicitationResult',
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
  'WorktreeCreate',
  'WorktreeRemove',
]

/** The note of every classic event's [詳細]. */
export const CLASSIC_NOTE =
  '設定ファイルのフック（classic）と同じイベント。共通の項目（session_id、transcript_path、cwd、permission_mode など）だけを出し、ほかの項目はキー名だけ（プロンプトやツールの中身を出さないため）'

/**
 * The calls made only from a button. `cost` marks what a press spends: 'tokens' (a model
 * call), 'api' (an API call), 'network', 'process' (a command run on the host), or none.
 * `section`: 'getters' for [session.repo] (it reads git), else 'calls'. values.js's
 * callValue() makes each call, by id.
 */
export const CALLS = [
  { id: 'session.repo', section: 'getters', button: '取得する（git を読む）', cost: 'process', note: 'セッションのフォルダの git リポジトリ（root、remote、internal、name）。呼ぶたびに作業コピーを読むので、自動では取らない' },
  { id: 'fs.stat', section: 'calls', button: '調べる', note: "$.fs.stat('.')：作業フォルダの種類・大きさ・更新時刻。中身は読まない" },
  { id: 'fs.list', section: 'calls', button: '一覧を取る', note: '$.fs.list()：作業フォルダの項目。名前と種類の数だけ（中身は読まない）' },
  { id: 'fs.exists', section: 'calls', button: '確かめる', note: '$.fs.exists：作業フォルダに CLAUDE.md、README.md、.git があるか' },
  {
    id: 'fs.ancestors',
    section: 'calls',
    button: '探す',
    note: "$.fs.ancestors({ names: ['CLAUDE.md'] })：上のフォルダの CLAUDE.md。見つかったフォルダと中身の文字数だけ（中身は出さない）",
  },
  {
    id: 'settings.read',
    section: 'calls',
    button: 'キー名を読む',
    note: '$.settings.read()：すべての設定元を重ねた設定。秘密が入りうる（env やヘルパーのコマンドもそのまま来る）ので、キー名と、その値の型・件数だけ',
  },
  {
    id: 'env.get',
    section: 'calls',
    button: '有無を見る',
    note: '$.env.get：Claude Code に関わる環境変数がいくつか。値は出さず、設定されているかと文字数だけ。名前はソースに文字列で書いたものしか読めない',
  },
  { id: 'session.messages', section: 'calls', button: '数える', note: '$.session.messages()：会話のメッセージの数と、最後のメッセージの role だけ（本文は出さない）' },
  {
    id: 'session.authorize',
    section: 'calls',
    button: '種類を見る',
    note: '$.session.authorize()：セッションの資格情報の種類（bearer / api-key）か null。資格情報そのものはプラグインに来ない。handle も出さない',
  },
  {
    id: 'session.usage/summary',
    section: 'calls',
    button: '内訳を取る（手元で見積もる）',
    note: "$.session.usage({ breakdown: 'summary' })：コンテキストの内訳を手元で見積もる。分類ごとのトークン数と、メモリファイル・MCP ツール・エージェントの数",
  },
  {
    id: 'session.usage/full',
    section: 'calls',
    button: '内訳を取る（API を呼ぶ）',
    cost: 'api',
    note: "$.session.usage({ breakdown: 'full' })：/context と同じく、分類ごとにトークン数を数える API を呼ぶ（費用がかかる場合がある）",
  },
  {
    id: 'process.run',
    section: 'calls',
    button: 'git を実行する',
    cost: 'process',
    note: "$.process.run(['git', 'rev-parse', '--short', 'HEAD'])：今のコミットの短いハッシュ。exitCode、stdout、stderr の文字数",
  },
  {
    id: 'model.complete',
    section: 'calls',
    button: '呼ぶ（トークンを使う）',
    cost: 'tokens',
    note: "$.model.complete({ model: 'haiku', prompt, maxTokens: 20 })：短い問いを 1 回送る。トークンを使う。答えの文字と usage を出す",
  },
  {
    id: 'http.fetch',
    section: 'calls',
    button: '取りに行く（ネットワーク）',
    cost: 'network',
    note: "$.http.fetch('https://example.com/')：ホストを通して取りに行く。status、ok、ヘッダーの数、本文の文字数だけ",
  },
  {
    id: 'mcp.call',
    section: 'calls',
    button: 'サーバーとツールを見る（呼ばない）',
    note: '$.mcp.call は呼ばない：どの MCP ツールに副作用がないかは名前からは分からないため。代わりに $.tool.list() から MCP のツールを拾い、サーバーごとのツールの数を出す',
  },
]

/** The view's sections, in order: their keys, headings and one line under each heading. */
export const SECTIONS = [
  { id: 'getters', title: '$ の取得系', about: '開いたときと「再取得」で取る。● の付いた値は、この画面を開いている間 5 秒ごとに取り直し、時刻のほかに変わった値があるときだけ描き直す' },
  { id: 'events', title: 'イベントの入力（最後に受け取ったもの）', about: 'フックが受け取った e の最後の 1 回。どれも e を変えずに次へ渡している' },
  { id: 'calls', title: 'ボタンで呼ぶもの（費用・副作用あり）', about: '押したときだけ呼ぶ。（トークンを使う）（API を呼ぶ）（ネットワーク）の付いたボタンは費用や通信が発生する' },
  { id: 'stores', title: 'state / store', about: 'この mod 自身の $.state と $.store を読む（書き込みはしない）' },
]

// ----- Formatting -----

/** A string cut to `limit` characters, with its full length when cut. */
export function cut(text, limit) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…（全 ${text.length} 文字）`
}

// The name a list item is known by in a row: a string itself, or its name, id or key
function nameOf(item) {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    for (const field of ['name', 'id', 'key', 'kind', 'dir']) {
      if (typeof item[field] === 'string') return item[field]
    }
  }
  return cut(JSON.stringify(item) ?? String(item), 20)
}

/**
 * One value as a row shows it: a string cut to TEXT_LIMIT, a list as `n 件` and its first
 * names, an object as JSON cut to JSON_LIMIT.
 */
export function formatShort(value) {
  if (value === undefined) return '（なし）'
  if (value === null) return 'null'
  if (typeof value === 'string') return cut(value, TEXT_LIMIT)
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '0 件'
    const names = value.slice(0, NAMES_SHOWN).map(nameOf).join(', ')
    return `${value.length} 件: ${names}${value.length > NAMES_SHOWN ? ' …' : ''}`
  }
  return cut(JSON.stringify(value), JSON_LIMIT)
}

/** One value as its [詳細] shows it: indented JSON cut to FULL_LIMIT. */
export function formatFull(value) {
  if (value === undefined) return '（なし）'
  return cut(JSON.stringify(value, null, 2) ?? String(value), FULL_LIMIT)
}

/** What the view keeps of one value: the row's text and the [詳細]'s. */
export function entryOf(value) {
  return { short: formatShort(value), full: formatFull(value) }
}

/** What the view keeps of a call that failed. */
export function errorEntry(error) {
  const text = String(error?.message ?? error)
  return { short: 'エラー: ' + cut(text, TEXT_LIMIT), full: text, isError: true }
}

/** The entry a call button shows while its call runs. */
export const RUNNING = { short: '実行中…', full: '実行中…' }

// ----- Reducing values to what may be shown -----

/** A tool or command list: names and kinds, descriptions cut. */
export function toolsOf(list) {
  return list.map(tool => ({ name: tool.name, mcp: tool.mcp, description: cut(tool.description ?? '', TEXT_LIMIT) }))
}

export function commandsOf(list) {
  return list.map(command => ({
    name: command.name,
    source: command.source,
    plugin: command.plugin,
    description: cut(command.description ?? '', TEXT_LIMIT),
  }))
}

export function agentsOf(list) {
  return list.map(agent => ({ id: agent.id, type: agent.type, status: agent.status, description: cut(agent.description ?? '', TEXT_LIMIT) }))
}

/** /config's rows: a text value as its length only. */
export function configOf(rows) {
  return rows.map(row => ({
    key: row.key,
    kind: row.kind,
    value: typeof row.value === 'string' ? `（文字列 ${row.value.length} 文字）` : row.value,
    isLocked: row.isLocked,
    provider: row.provider?.kind ?? row.provider,
  }))
}

/** $.session.usage() without a breakdown: as it came, less any breakdown. */
export function usageOf(usage) {
  if (!usage || typeof usage !== 'object') return usage
  const { breakdown, ...context } = usage.context ?? {}
  return { ...usage, context }
}

/** A usage with a breakdown: the breakdown's figures and counts, no file contents. */
export function breakdownOf(usage) {
  const breakdown = usage?.context?.breakdown
  if (!breakdown) return { context: usageOf(usage)?.context, breakdown: '（なし）' }
  return {
    context: usageOf(usage).context,
    breakdown: {
      totalTokens: breakdown.totalTokens,
      maxTokens: breakdown.maxTokens,
      percentage: breakdown.percentage,
      model: breakdown.model,
      categories: (breakdown.categories ?? []).map(category => ({ name: category.name, tokens: category.tokens })),
      memoryFiles: (breakdown.memoryFiles ?? []).length,
      mcpTools: (breakdown.mcpTools ?? []).length,
      agents: (breakdown.agents ?? []).length,
      gridRows: (breakdown.gridRows ?? []).length,
      apiUsage: breakdown.apiUsage ?? null,
    },
  }
}

/** The settings: each top-level key with its value's type and size, never the value. */
export function settingsShape(settings) {
  const shape = {}
  for (const [key, value] of Object.entries(settings ?? {})) shape[key] = shapeOf(value)
  return { keys: Object.keys(shape).length, shape }
}

function shapeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `配列 ${value.length} 件`
  if (typeof value === 'object') return `オブジェクト ${Object.keys(value).length} キー`
  if (typeof value === 'string') return `文字列 ${value.length} 文字`
  return typeof value
}

/** Environment variables by name: set with its length, or unset. Never the value. */
export function envShape(values) {
  const shape = {}
  for (const [name, value] of Object.entries(values)) {
    shape[name] = value === undefined ? '未設定' : `設定あり（${value.length} 文字）`
  }
  return shape
}

/** The transcript: how many messages, and the last one's role. */
export function messagesShape(found) {
  if (!Array.isArray(found)) return { deny: found?.deny }
  return { count: found.length, lastRole: found.at(-1)?.role ?? '（なし）' }
}

/** A directory listing: how many of each kind, and the names. */
export function listShape(entries) {
  const kinds = {}
  for (const entry of entries) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1
  return { count: entries.length, kinds, names: entries.map(entry => entry.name) }
}

/** CLAUDE.md files above: their folders and lengths, never their text. */
export function ancestorsShape(found) {
  return found.map(file => ({ dir: file.dir, file: file.name, length: (file.content ?? '').length }))
}

/** An HTTP response: its status and sizes, not its body. */
export function httpShape(response) {
  return {
    status: response.status,
    ok: response.ok,
    headers: Object.keys(response.headers ?? {}).length,
    length: (response.text ?? '').length,
  }
}

/** A finished process: its exit code, its stdout (a short hash here), stderr's length. */
export function processShape(result) {
  return { exitCode: result.exitCode, stdout: cut((result.stdout ?? '').trim(), TEXT_LIMIT), stderr: (result.stderr ?? '').length }
}

/** A model completion: the reply cut, its usage, or why there is none. */
export function modelShape(result) {
  if (!result.isAnswered) return { isAnswered: false, reason: result.reason, status: result.status, error: result.error }
  return { isAnswered: true, text: cut(result.text, TEXT_LIMIT), usage: result.usage }
}

/** MCP servers from the tool list: tool names `mcp__<server>__<tool>`, counted by server. */
export function mcpShape(tools) {
  const servers = {}
  for (const tool of tools) {
    if (!tool.mcp) continue
    const match = /^mcp__(.+?)__(.+)$/.exec(tool.name)
    const server = match ? match[1] : '（不明）'
    servers[server] = (servers[server] ?? 0) + 1
  }
  return { servers: Object.keys(servers).length, tools: servers }
}

/** What a session's stat shows: kind, size, time, link; realPath is not asked. */
export function statShape(stat) {
  return { kind: stat.kind, size: stat.size, mtimeMs: stat.mtimeMs, isLink: stat.isLink }
}

// ----- Event inputs -----

/** The keys of an object, or none. */
const keysOf = value => (value && typeof value === 'object' ? Object.keys(value) : [])

/**
 * One engine event's input reduced to what the view may show: counts and lengths for text a
 * person wrote or the model answered, key names for a tool's input.
 */
export function eventShape(name, e) {
  switch (name) {
    case 'session.start':
      return { cwd: e.cwd, surface: e.surface, isInteractive: e.isInteractive }
    case 'session.end':
      return { reason: e.reason, sessionId: e.sessionId, resume: e.resume }
    case 'session.measure':
      return {
        context: { tokens: e.context?.tokens, window: e.context?.window, percent: e.context?.percent },
        rateLimits: (e.rateLimits ?? []).map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt })),
        cost: e.cost,
        changed: e.changed,
      }
    case 'session.attach':
      return { surface: e.surface, clientId: e.clientId, viewport: e.viewport }
    case 'session.detach':
      return { surface: e.surface, clientId: e.clientId, reason: e.reason }
    case 'session.receive':
      return { origin: e.origin?.kind, textLength: (e.text ?? '').length, event: e.event, agentId: e.agentId }
    case 'session.compact':
      return {
        trigger: e.trigger,
        agentId: e.agentId,
        instructionsLength: e.instructions === undefined ? undefined : e.instructions.length,
        messages: (e.messages ?? []).length,
      }
    case 'prompt.submit':
      return {
        textLength: (e.text ?? '').length,
        attachments: (e.attachments ?? []).length,
        context: (e.context ?? []).length,
        turnId: e.turnId,
        wait: e.wait,
        origin: e.origin?.kind,
      }
    case 'turn.start':
      return { turnId: e.turnId, textLength: (e.text ?? '').length }
    case 'turn.complete':
      return {
        turnId: e.turnId,
        agentId: e.agentId,
        reason: e.reason,
        isAborted: e.isAborted,
        durationMs: e.durationMs,
        answerLength: (e.answer ?? '').length,
        usage: e.usage,
      }
    case 'plugin.register':
      return { name: e.name, tier: e.tier, version: e.version, provenance: e.provenance, uses: keysOf(e.uses) }
    default:
      return { keys: keysOf(e) }
  }
}

/** A turn.step: its input, and what the step returned. */
export function stepShape(e, result) {
  return {
    turnId: e.turnId,
    index: e.index,
    model: e.model,
    effort: e.effort,
    messageCount: e.messageCount,
    result: result
      ? {
          stopReason: result.stopReason,
          toolUses: (result.toolUses ?? []).length,
          answerLength: (result.answer ?? '').length,
          usage: result.usage,
        }
      : '（なし）',
  }
}

/** A tool call: the tool, its input's key names, and the outcome's kind and size. */
export function toolCallShape(e, result) {
  const input = Object.keys(e).filter(key => key !== 'tool' && key !== 'tool_use_id' && key !== 'agentId')
  let outcome
  if (!result || typeof result !== 'object') outcome = '（なし）'
  else if (typeof result.deny === 'string') outcome = { deny: cut(result.deny, TEXT_LIMIT) }
  else outcome = { isError: result.isError ?? false, textLength: typeof result.text === 'string' ? result.text.length : undefined }
  return { tool: e.tool, agentId: e.agentId, inputKeys: input, result: outcome }
}

/** The fields every classic event shares (BaseHookInput); the rest by key name only. */
const CLASSIC_COMMON = ['session_id', 'transcript_path', 'cwd', 'prompt_id', 'permission_mode', 'agent_id', 'agent_type']

/**
 * A classic event's input: its common fields, and the names of the rest. PreToolUse's `e`
 * is the tool call's envelope instead: the tool and its input's key names.
 */
export function classicShape(name, e) {
  if (name === 'classic.PreToolUse') {
    const { tool, inputKeys } = toolCallShape(e, undefined)
    return { tool, inputKeys }
  }
  const shape = {}
  for (const field of CLASSIC_COMMON) if (e[field] !== undefined) shape[field] = e[field]
  if (e.effort?.level !== undefined) shape.effort = e.effort.level
  shape.otherKeys = Object.keys(e).filter(key => key !== 'hook_event_name' && key !== 'effort' && !CLASSIC_COMMON.includes(key))
  return shape
}

// ----- Keys -----

/** An element key from a prefix and a value's id; element keys allow a plain set of characters. */
export const valueKey = (prefix, id) => prefix + '-' + id.replace(/[^A-Za-z0-9_-]/g, '_')

/**
 * Whether two getter snapshots differ apart from the clock: the auto refresh writes, and so
 * redraws the view, only when one does.
 */
export function differsApartFromClock(before, after) {
  const strip = values => JSON.stringify({ ...values, 'clock.now': undefined })
  return strip(before ?? {}) !== strip(after)
}
