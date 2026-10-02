// The list of every place this mod draws or calls, what the per-site on/off switches mean, and the
// call counts the pane shows. Each SITES entry's `id` is also the `[id]` label its output
// starts with and the label in the heading comment above its code, so grepping `[Spinner]`
// finds the entry, the hook and the text on screen.

export const PANE = 'ui-sampler'
export const COMMAND = 'ui-sampler'

/**
 * kind: 'render' (a ui.render site), 'api' (a $ method the pane calls), 'event' (a hook on
 * an engine event). toggleable sites can be switched off from the pane; an off site's hook
 * passes `next(e)` on unchanged.
 */
export const SITES = [
  {
    id: 'PromptHint',
    label: '[PromptHint]',
    kind: 'render',
    where: 'プロンプト欄の下の薄いヒント行',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'Spinner',
    label: '[Spinner]',
    kind: 'render',
    where: 'ターンの実行中に動く行',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'SessionMode',
    label: '[SessionMode]',
    kind: 'render',
    where: 'プロンプト欄のフッターにあるモード表示',
    toggleable: true,
    defaultOn: true,
  },
  {
    id: 'CommandOutput',
    label: '[CommandOutput]',
    kind: 'render',
    where: '/ui-sampler を実行した後、会話欄に残る結果の行',
    toggleable: true,
    defaultOn: true,
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
    id: '$.ui.status',
    label: '[$.ui.status]',
    kind: 'api',
    where: 'プロンプト欄の下に残るステータス行',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.toast',
    label: '[$.ui.toast]',
    kind: 'api',
    where: '会話欄の右上に数秒だけ出る小さな箱',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.log',
    label: '[$.ui.log]',
    kind: 'api',
    where: '会話欄に薄い 1 行（モデルには送られない）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.ui.ask',
    label: '[$.ui.ask]',
    kind: 'api',
    where: '標準の質問ダイアログ',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: '$.session.append',
    label: '[$.session.append]',
    kind: 'api',
    where: '会話の記録に残る system 行（モデルは読まない）',
    toggleable: false,
    defaultOn: true,
  },
  {
    id: 'command.run',
    label: '[command.run]',
    kind: 'event',
    where: '/ui-sampler の実行。返した text が [CommandOutput] の行になる',
    toggleable: false,
    defaultOn: true,
  },
]

export const KIND_LABEL = { render: '描画', api: 'API', event: 'イベント' }

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
