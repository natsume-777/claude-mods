// The values view of the pane (view 'values', the 値 category): what a mod can obtain, one
// compact row per value with a [詳細] that shows it in full (still reduced, value-format.js).
// Four sections:
//   $ の取得系        the getters on $, fetched when the view opens and on [再取得]; the light
//                     ones again every AUTO_REFRESH_MS while the view is shown, never otherwise.
//                     [session.repo] reads git, so it waits for its button
//   イベントの入力    the last input of each engine event below and of every classic.* event,
//                     kept by hooks that pass every event on unchanged
//   ボタンで呼ぶもの  calls that cost tokens, an API call, the network or a process, or read
//                     what may hold secrets: made only from their buttons
//   state / store     this mod's own $.state and $.store, read only
//
// Everything the view shows is in $.state (getters, events, calls), written from presses,
// timers and event hooks, never while drawing. Reading it while drawing subscribes the view,
// so a write redraws the pane only while the values view is the one drawn (redraw.js); the
// event hooks write at most once per REDRAW_GAP_MS while it is, and at once otherwise
// (event-log.js).
// Spacing, columns and button roles come from style.js.

import {
  GETTERS,
  AUTO_GETTERS,
  EVENTS,
  CLASSIC_EVENTS,
  CLASSIC_NOTE,
  CALLS,
  SECTIONS,
  HOOK_NOTE,
  AUTO_REFRESH_MS,
  RUNNING,
  entryOf,
  errorEntry,
  toolsOf,
  commandsOf,
  agentsOf,
  configOf,
  usageOf,
  breakdownOf,
  settingsShape,
  envShape,
  messagesShape,
  listShape,
  ancestorsShape,
  httpShape,
  processShape,
  modelShape,
  mcpShape,
  statShape,
  eventShape,
  stepShape,
  toolCallShape,
  classicShape,
  valueKey,
  differsApartFromClock,
} from './value-format.js'
import { CATEGORIES, noteCall } from './sites.js'
import { SPACE, WIDTH, COLOR, BUTTON, choice, dim, inline, cell, fill, tableRow, header, section, card, page } from './style.js'
import { noteInvalidate, notePaneRender } from './diag.js'
import { redrawFor, notePaneShows, paneShowsView } from './redraw.js'
import { guardDrawing } from './press-guard.js'
import { holdEvent, takeHeld, mergeHeld, restoreHeld } from './event-log.js'
import { atom, read, update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts): the pane's view, the
// row each category view details (this view's under 'values'), the getters' last answers,
// the events' last inputs, and each call button's last result
const view = atom({ plugin: 'ui-sampler', key: 'view' }, 'toc')
const SELECTED = { plugin: 'ui-sampler', key: 'selected' }
const getters = atom({ plugin: 'ui-sampler', key: 'getters' }, {})
const events = atom({ plugin: 'ui-sampler', key: 'events' }, {})
const CALL_RESULTS = { plugin: 'ui-sampler', key: 'calls' }

const CATEGORY = CATEGORIES.find(one => one.id === 'values')
const ALL_GETTERS = GETTERS.map(getter => getter.id)

/** The one prompt [model.complete] sends. */
const MODEL_PROMPT = '「はい」とだけ答えてください。'
/** The one URL [http.fetch] asks for. */
const FETCH_URL = 'https://example.com/'

// ----- The getters -----

// One function rather than a table of closures: the engine follows $ only into functions
// declared in this file, called by name. Each case answers the value as it may be shown.
async function getterValue($, id) {
  switch (id) {
    // ===== [plugin.name] [plugin.root] $.plugin.name / $.plugin.root (properties) =====
    case 'plugin.name':
      return $.plugin.name
    case 'plugin.root':
      return $.plugin.root

    // ===== [session.*] $.session.id() / cwd() / root() / model() / turns() / version() / surfaces() =====
    case 'session.id':
      return $.session.id()
    case 'session.cwd':
      return $.session.cwd()
    case 'session.root':
      return $.session.root()
    case 'session.model':
      return $.session.model()
    case 'session.turns':
      return $.session.turns()
    case 'session.version':
      return $.session.version()
    case 'session.surfaces':
      return $.session.surfaces()

    // ===== [session.usage] $.session.usage() (no breakdown: costs nothing) =====
    case 'session.usage':
      return usageOf(await $.session.usage())

    // ===== [tool.list] [command.list] [agent.list] [config.list] =====
    case 'tool.list':
      return toolsOf(await $.tool.list())
    case 'command.list':
      return commandsOf(await $.command.list())
    case 'agent.list':
      return agentsOf(await $.agent.list())
    case 'config.list':
      return configOf(await $.config.list())

    // ===== [ui.panes] $.ui.panes() =====
    case 'ui.panes':
      return $.ui.panes()

    // ===== [clock.now] $.clock.now() =====
    case 'clock.now':
      return $.clock.now()

    // ===== [state.get] $.state.get of this mod's own refs, with their versions =====
    case 'state.get': {
      const shown = await $.state.get({ plugin: 'ui-sampler', key: 'view' })
      const hint = await $.state.get({ plugin: 'ui-sampler', key: 'promptHintMode' })
      const spinner = await $.state.get({ plugin: 'ui-sampler', key: 'spinnerMode' })
      const output = await $.state.get({ plugin: 'ui-sampler', key: 'commandOutputMode' })
      return { view: shown, promptHintMode: hint, spinnerMode: spinner, commandOutputMode: output }
    }

    // ===== [store.keys] [store.get] $.store.keys() / $.store.get(key), read only =====
    case 'store.keys':
      return $.store.keys()
    case 'store.get': {
      const values = {}
      for (const key of (await $.store.keys()).slice(0, 10)) values[key] = await $.store.get(key)
      return values
    }

    default:
      throw new Error('未対応: ' + id)
  }
}

/**
 * Fetches the getters `ids` and writes their answers (from a press or a timer, never while
 * drawing). `isAuto`: the timer's fetch, written only when something other than the clock
 * changed, so the view is not redrawn every period for nothing.
 */
async function fetchGetters($, ids, isAuto) {
  const fetched = {}
  for (const id of ids) {
    try {
      fetched[id] = entryOf(await getterValue($, id))
    } catch (error) {
      fetched[id] = errorEntry(error)
    }
  }
  const before = await read($, getters)
  if (isAuto && !differsApartFromClock(before, { ...before, ...fetched })) return
  await update($, getters, current => ({ ...current, ...fetched }))
}

// The timer of the light getters, while the values view is shown
let ticker

// Starts the timer once, and fetches every getter: called by a drawing of the values view
// that follows a drawing of another view (or none), i.e. when the view opens. Timers are not
// state writes, so a drawing may start them; the fetch itself runs from the timer.
function onOpen($) {
  try {
    $.clock.after(0, () => fetchGetters($, ALL_GETTERS, false).catch(() => {}))
    if (!ticker) ticker = $.clock.every(AUTO_REFRESH_MS, () => tick($).catch(() => {}))
  } catch {
    // A host that refuses timers: [再取得] still fetches
  }
}

// One period: stops once the values view is no longer drawn (another view, or the pane
// closed), else writes what the event hooks held back (event-log.js) and fetches the light
// getters
async function tick($) {
  if (!paneShowsView('values')) {
    ticker?.cancel()
    ticker = undefined
    return
  }
  await writeHeld($)
  await fetchGetters($, AUTO_GETTERS, true)
}

// ----- The event inputs -----

// Keeps one event's reduced input for this view (event-log.js): written now, unless this view
// is shown and wrote within REDRAW_GAP_MS, when the view's timer writes it. Never throws: an
// event goes on whatever happens. register.js and events.js keep one of their own each.
async function keepEvent($, name, shape) {
  const batch = holdEvent(name, shape, Date.now(), paneShowsView('values'))
  if (!batch) return
  try {
    await update($, events, current => mergeHeld(current, batch))
  } catch {
    // Refused (before the session binds, say): held again for the next write
    restoreHeld(batch)
  }
}

// Writes what the event hooks held back while this view was shown (from its timer)
async function writeHeld($) {
  const batch = takeHeld(Date.now())
  if (!batch) return
  try {
    await update($, events, current => mergeHeld(current, batch))
  } catch {
    restoreHeld(batch)
  }
}

// ----- The call buttons -----

// One function rather than a table of closures, as getterValue. Each case answers the value
// as it may be shown: counts, lengths and key names where the value could hold secrets.
async function callValue($, id) {
  switch (id) {
    // ===== [session.repo] $.session.repo() (reads git) =====
    case 'session.repo':
      return $.session.repo()

    // ===== [fs.stat] $.fs.stat('.') =====
    case 'fs.stat':
      return statShape(await $.fs.stat('.'))

    // ===== [fs.list] $.fs.list() =====
    case 'fs.list':
      return listShape(await $.fs.list())

    // ===== [fs.exists] $.fs.exists(path) =====
    case 'fs.exists':
      return {
        'CLAUDE.md': await $.fs.exists('CLAUDE.md'),
        'README.md': await $.fs.exists('README.md'),
        '.git': await $.fs.exists('.git'),
      }

    // ===== [fs.ancestors] $.fs.ancestors({ names: ['CLAUDE.md'] }) =====
    case 'fs.ancestors':
      return ancestorsShape(await $.fs.ancestors({ names: ['CLAUDE.md'] }))

    // ===== [settings.read] $.settings.read() (key names only) =====
    case 'settings.read':
      return settingsShape(await $.settings.read())

    // ===== [env.get] $.env.get(name), each name a literal (set or unset, and the length) =====
    case 'env.get':
      return envShape({
        CLAUDE_CODE_ENTRYPOINT: await $.env.get('CLAUDE_CODE_ENTRYPOINT'),
        CLAUDE_CODE_EXECPATH: await $.env.get('CLAUDE_CODE_EXECPATH'),
        CLAUDE_CONFIG_DIR: await $.env.get('CLAUDE_CONFIG_DIR'),
        CLAUDE_CODE_USE_BEDROCK: await $.env.get('CLAUDE_CODE_USE_BEDROCK'),
        CLAUDE_CODE_USE_VERTEX: await $.env.get('CLAUDE_CODE_USE_VERTEX'),
        ANTHROPIC_MODEL: await $.env.get('ANTHROPIC_MODEL'),
        ANTHROPIC_BASE_URL: await $.env.get('ANTHROPIC_BASE_URL'),
        ANTHROPIC_API_KEY: await $.env.get('ANTHROPIC_API_KEY'),
      })

    // ===== [session.messages] $.session.messages() (count and last role only) =====
    case 'session.messages':
      return messagesShape(await $.session.messages())

    // ===== [session.authorize] $.session.authorize() (kind or null; never the handle) =====
    case 'session.authorize': {
      const authorization = await $.session.authorize()
      return authorization ? { kind: authorization.kind } : null
    }

    // ===== [session.usage/summary] $.session.usage({ breakdown: 'summary' }) =====
    case 'session.usage/summary':
      return breakdownOf(await $.session.usage({ breakdown: 'summary' }))

    // ===== [session.usage/full] $.session.usage({ breakdown: 'full' }) (an API call) =====
    case 'session.usage/full':
      return breakdownOf(await $.session.usage({ breakdown: 'full' }))

    // ===== [process.run] $.process.run(['git', 'rev-parse', '--short', 'HEAD']) =====
    case 'process.run':
      return processShape(await $.process.run(['git', 'rev-parse', '--short', 'HEAD']))

    // ===== [model.complete] $.model.complete({ model: 'haiku', prompt, maxTokens }) (tokens) =====
    case 'model.complete':
      return modelShape(await $.model.complete({ model: 'haiku', prompt: MODEL_PROMPT, maxTokens: 20 }))

    // ===== [http.fetch] $.http.fetch(FETCH_URL) (the network) =====
    case 'http.fetch':
      return httpShape(await $.http.fetch(FETCH_URL))

    // ===== [mcp.call] not called: the MCP servers and their tools, from $.tool.list() =====
    case 'mcp.call':
      return mcpShape(await $.tool.list())

    default:
      throw new Error('未対応: ' + id)
  }
}

// Runs one call from its button: says it runs, then writes what it answered or why it failed
async function runCall($, id) {
  await update($, { ...CALL_RESULTS, id }, () => RUNNING)
  let entry
  try {
    entry = entryOf(await callValue($, id))
  } catch (error) {
    entry = errorEntry(error)
  }
  await update($, { ...CALL_RESULTS, id }, () => entry)
}

// ----- The view -----

// Counts the call, and redraws once when a site or surface is new and the main pane lists
// the site (redraw.js)
function noteRender($, id, e) {
  const isNew = noteCall(id, e.surface)
  if (!redrawFor(id, { isNew }, Date.now())) return
  noteInvalidate(`${id} の初回描画（新しい surface）`)
  $.ui.invalidate('ui.render')
}

// Switches the pane's view from a press handler (never while drawing), and brings the new
// view's top into sight
async function go($, next) {
  await update($, view, () => next)
  await $.ui.scroll({ in: 'ui-sampler', to: 'start' })
}

// Picks the row to detail, or clears the pick when it is pressed again (never while drawing).
// Cleared is '' ($.state.set takes no undefined), which names no row.
function select($, rowId) {
  return update($, { ...SELECTED, id: 'values' }, value => (value === rowId ? '' : rowId))
}

/**
 * One value's row: its label, [詳細], then its text (and the call's button above the text),
 * with the [詳細] card under it when picked. `row`: { id, label, entry, empty, note, count,
 * action }. Pure but for the press handlers it is handed.
 */
function valueRow(ui, row, picked, onDetail) {
  const { Box, Text, Button } = ui
  const isPicked = picked === row.id
  const entry = row.entry
  const text = entry ? (row.count ? `（${row.count} 回）` : '') + entry.short : row.empty
  const value = Box({
    key: valueKey('value', row.id),
    width: '100%',
    children: [Text({ wrap: 'wrap', dimColor: !entry, color: entry?.isError ? COLOR.warn : undefined, children: [text] })],
  })
  const line = tableRow(
    ui,
    valueKey('line', row.id),
    [
      cell(ui, WIDTH.value, [Text({ children: [row.label] })]),
      cell(ui, WIDTH.detail, [
        Button({ key: valueKey('vdetail', row.id), label: '詳細', ...choice(isPicked), onPress: () => onDetail(row.id) }),
      ]),
      fill(ui, row.action ? [inline(ui, valueKey('action', row.id), [row.action]), value] : [value], 'column'),
    ],
    'flex-start',
  )
  const detail = isPicked
    ? card(ui, valueKey('card', row.id), [
        Text({ bold: true, children: [`${row.label} の詳細`] }),
        dim(ui, valueKey('note', row.id), row.note),
        Box({ key: valueKey('full', row.id), width: '100%', children: [Text({ wrap: 'wrap', children: [entry ? entry.full : row.empty] })] }),
      ])
    : null
  return Box({ key: valueKey('entry', row.id), flexDirection: 'column', rowGap: SPACE.row, width: '100%', children: [line, detail] })
}

// ===== [Pane/values] the values view =====
// `guard` (press-guard.js) keeps this drawing's Button closures for [press/再実行]
async function drawValues($, e, guard) {
  const ui = guard.wrap($.ui.resolve(e))
  const { Text, Button } = ui

  // Reading these subscribes the view: a write redraws it while it is shown
  const picked = await read($, { ...SELECTED, id: 'values' })
  const fetched = await read($, getters)
  const received = await read($, events)
  const results = {}
  for (const call of CALLS) results[call.id] = await read($, { ...CALL_RESULTS, id: call.id })

  const onDetail = rowId => select($, rowId)
  const rows = { getters: [], events: [], calls: [], stores: [] }

  // ----- $ の取得系 and state / store: the getters, then [session.repo] -----
  for (const getter of GETTERS) {
    rows[getter.section].push(
      valueRow(
        ui,
        {
          id: 'g:' + getter.id,
          label: `[${getter.id}]${getter.isAuto ? ' ●' : ''}`,
          entry: fetched[getter.id],
          empty: 'まだ取得していない',
          note: `${getter.note}。${HOOK_NOTE}`,
        },
        picked,
        onDetail,
      ),
    )
  }

  // ----- ボタンで呼ぶもの: one row per call, its button in the row -----
  for (const call of CALLS) {
    rows[call.section].push(
      valueRow(
        ui,
        {
          id: 'c:' + call.id,
          label: `[${call.id}]`,
          entry: results[call.id],
          empty: 'まだ呼んでいない',
          note: `${call.note}。${HOOK_NOTE}`,
          action: Button({ key: valueKey('call', call.id), label: call.button, onPress: () => runCall($, call.id) }),
        },
        picked,
        onDetail,
      ),
    )
  }

  // ----- イベントの入力: the engine events, then every classic event received -----
  for (const event of EVENTS) {
    const entry = received[event.id]
    rows.events.push(
      valueRow(
        ui,
        { id: 'e:' + event.id, label: `[${event.id}]`, entry, count: entry?.count, empty: 'まだ受け取っていない', note: event.note },
        picked,
        onDetail,
      ),
    )
  }
  const classicNames = Object.keys(received).filter(name => name.startsWith('classic.'))
  const known = CLASSIC_EVENTS.map(name => 'classic.' + name)
  classicNames.sort((a, b) => known.indexOf(a) - known.indexOf(b))
  rows.events.push(Text({ key: 'classic-heading', bold: true, children: [`classic.*（${classicNames.length} 種類を受け取った）`] }))
  for (const name of classicNames) {
    const entry = received[name]
    rows.events.push(
      valueRow(ui, { id: 'e:' + name, label: `[${name}]`, entry, count: entry?.count, empty: '', note: CLASSIC_NOTE }, picked, onDetail),
    )
  }
  const missing = known.filter(name => !classicNames.includes(name)).map(name => name.slice('classic.'.length))
  if (missing.length > 0) rows.events.push(dim(ui, 'classic-missing', 'まだ受け取っていない classic: ' + missing.join(', ')))

  return page(ui, [
    header(ui, {
      title: '[Pane] ' + CATEGORY.label,
      about: CATEGORY.about,
      nav: [
        Button({ key: 'contents', label: '目次へ', ...BUTTON.nav, onPress: () => go($, 'toc') }),
        Button({ key: 'refetch', label: '再取得', ...BUTTON.nav, onPress: () => fetchGetters($, ALL_GETTERS, false) }),
      ],
      note: HOOK_NOTE,
    }),
    ...SECTIONS.map(one =>
      section(ui, 'values-' + one.id, one.title, [dim(ui, `values-${one.id}-about`, one.about), ...rows[one.id]], SPACE.control),
    ),
  ])
}

export function registerValues(on) {
  // ===== [Pane/values] ui.render { component: 'Pane', requestId: 'ui-sampler' }, view 'values' =====
  // The same matcher as [Pane] (pane.js); registered before it and before [Pane/samples], so
  // this is the outermost link and passes every other view on with next(e)
  on('ui.render', { component: 'Pane', requestId: 'ui-sampler' }, async ($, e, next) => {
    if ((await read($, view)) !== 'values') return next(e)
    notePaneRender(e)
    noteRender($, 'Pane', e)
    if (!paneShowsView('values')) onOpen($)
    // This view's counts are in $.state, which redraws it; no other hook needs to (redraw.js)
    notePaneShows('values', undefined)
    const guard = guardDrawing(e.requestId)
    return guard.done(await drawValues($, e, guard))
  })

  // [session.start] is kept by register.js's hook, [turn.complete] by events.js's: a plugin
  // hooks an event without a matcher once

  // ===== [session.end] on('session.end') =====
  on('session.end', async ($, e, next) => {
    await keepEvent($, 'session.end', eventShape('session.end', e))
    return next(e)
  })

  // ===== [session.measure] on('session.measure') =====
  on('session.measure', async ($, e, next) => {
    await keepEvent($, 'session.measure', eventShape('session.measure', e))
    return next(e)
  })

  // ===== [session.attach] on('session.attach') =====
  on('session.attach', async ($, e, next) => {
    await keepEvent($, 'session.attach', eventShape('session.attach', e))
    return next(e)
  })

  // ===== [session.detach] on('session.detach') =====
  on('session.detach', async ($, e, next) => {
    await keepEvent($, 'session.detach', eventShape('session.detach', e))
    return next(e)
  })

  // ===== [session.receive] on('session.receive'): the text's length only =====
  on('session.receive', async ($, e, next) => {
    await keepEvent($, 'session.receive', eventShape('session.receive', e))
    return next(e)
  })

  // ===== [session.compact] on('session.compact'): counts only =====
  on('session.compact', async ($, e, next) => {
    await keepEvent($, 'session.compact', eventShape('session.compact', e))
    return next(e)
  })

  // ===== [prompt.submit] on('prompt.submit'): the text's length only =====
  on('prompt.submit', async ($, e, next) => {
    await keepEvent($, 'prompt.submit', eventShape('prompt.submit', e))
    return next(e)
  })

  // ===== [turn.start] on('turn.start') =====
  on('turn.start', async ($, e, next) => {
    await keepEvent($, 'turn.start', eventShape('turn.start', e))
    return next(e)
  })

  // ===== [turn.step] on('turn.step'): a stream, passed through whole with yield* =====
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    await keepEvent($, 'turn.step', stepShape(e, result))
    return result
  })

  // ===== [tool.call] on('tool.call'): the tool, its input's key names, the outcome =====
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await keepEvent($, 'tool.call', toolCallShape(e, result))
    return result
  })

  // ===== [plugin.register] on('plugin.register') =====
  on('plugin.register', async ($, e, next) => {
    await keepEvent($, 'plugin.register', eventShape('plugin.register', e))
    return next(e)
  })

  // ===== [classic.*] on('classic.*'): every classic event, its common fields =====
  on('classic.*', async ($, e, next) => {
    await keepEvent($, next.event, classicShape(next.event, e))
    return next(e)
  })
}
