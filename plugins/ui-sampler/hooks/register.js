// A reference mod for the places a mod can draw. Everything it puts on screen starts with an
// ASCII label in brackets, `[Spinner]`, `[$.ui.toast]`, naming the site or API that drew it;
// the same label is the `id` of its SITES entry (sites.js) and heads the code that draws it.
//
// sites.js         the SITES table, the per-site switches ($.state) and the call counts
// pane.js          [Pane]: one pane whose view switches: the table of contents, or one category's
//                  sites a line each with the [詳細] of one, and the one-shot API buttons
// elements.js      [Pane/samples] [Pane/Text] [Pane/Box] ...: the pane's view of one sample per
//                  element
// dialog.js        [DialogPane]: a second pane, opened with $.ui.open's dialog options
// engine-lines.js  [Spinner] [SessionMode] [PromptHint] [AbovePrompt] [CommandOutput]: the engine's
//                  own lines, and the band above the prompt
// transcript.js    [UserMessage] [AssistantMessage] [ToolUse] [ToolResult] [ToolGroup]: the
//                  transcript's rows; [ToolProgress] [TurnDuration] [InfoNotice]: counted only
// asks.js          [AskUserQuestion] [$.ui.notice]: the question dialog, the permission dialog
// events.js        [command.describe] [turn.complete] [prompt.suggest]: engine events that are
//                  not drawings (the $.prompt buttons are in pane.js)
// values.js        [Pane/values]: the 値 category's view, what a mod can obtain (the getters on
//                  $, the last input of each event, calls made from buttons, $.state and
//                  $.store), and the event hooks that keep those inputs
// value-format.js  the values view's tables, and the reducing of values to what may be shown
// redraw.js        when a hook's new call or props are worth redrawing the pane for
// diag.js          [診断/press]: the press, focus and redraw log
// press-guard.js   [press/再実行]: runs a press again that did not reach its onPress
// style.js         the shared look: spacing, column widths, colors, button roles, and pure
//                  builders for headers, sections, table rows, fields and cards

import { COMMAND, DIALOG_COMMAND, DIALOG_OPEN, PANE, noteCall } from './sites.js'
import { registerPane } from './pane.js'
import { registerElements } from './elements.js'
import { registerDialog } from './dialog.js'
import { registerEngineLines } from './engine-lines.js'
import { registerTranscript } from './transcript.js'
import { registerAsks } from './asks.js'
import { registerEvents } from './events.js'
import { registerValues } from './values.js'
import { holdEvent, mergeHeld, restoreHeld } from './event-log.js'
import { eventShape } from './value-format.js'
import { paneShowsView } from './redraw.js'
import { atom, update } from 'claude-code'

// The state this file writes (declared in types/index.d.ts): the pane's view, [DialogPane]'s
// echo lines, which say which entry opened it, and the values view's event inputs
const view = atom({ plugin: 'ui-sampler', key: 'view' }, 'toc')
const ECHO = { plugin: 'ui-sampler', key: 'echo' }
const EVENTS = { plugin: 'ui-sampler', key: 'events' }

// Keeps one event's reduced input for the values view (event-log.js): written now, unless
// that view is shown and wrote within REDRAW_GAP_MS, when its timer (values.js) writes it.
// Never throws: the event goes on whatever happens.
async function keepEvent($, name, shape) {
  const batch = holdEvent(name, shape, Date.now(), paneShowsView('values'))
  if (!batch) return
  try {
    await update($, EVENTS, current => mergeHeld(current, batch))
  } catch {
    restoreHeld(batch)
  }
}

export function register(on) {
  // ===== session.start: /ui-sampler, /ui-sampler-dialog and the first [$.ui.status] =====
  // Also keeps its input for the values view's [session.start] (values.js hooks the other
  // events; a plugin hooks an event without a matcher once)
  on('session.start', async ($, e, next) => {
    await keepEvent($, 'session.start', eventShape('session.start', e))
    await $.command.register({ name: COMMAND, description: 'UI の見本パネルを開く' })
    await $.command.register({ name: DIALOG_COMMAND, description: 'ダイアログ風のパネル [DialogPane] を開く' })
    noteCall('$.ui.status')
    $.ui.status('[$.ui.status] セッション開始時に出したステータス行です')
    return next(e)
  })

  // ===== [command.run] on('command.run', { command: 'ui-sampler' }) =====
  // Its text becomes the transcript row [CommandOutput] draws (engine-lines.js). The matcher is
  // a literal (COMMAND's value) so `plugin validate` can list it; an imported const shows as `?`.
  // It starts the pane at the contents, which is also the way back from a view that does not draw.
  on('command.run', { command: 'ui-sampler' }, async $ => {
    noteCall('command.run')
    await update($, view, () => 'toc')
    const opened = await $.ui.open({ id: PANE, title: '[Pane] UI 見本市' })
    const placed = opened.isPlaced ? '' : `（まだ表示されていない: ${opened.reason}）`
    return { text: `[command.run] UI 見本パネルを開きました${placed}` }
  })

  // ===== [command.run] on('command.run', { command: 'ui-sampler-dialog' }) =====
  // Another entry point for [DialogPane], beside the main pane's dialogs view button and the band's: a
  // command the person typed, with the same open options (DIALOG_OPEN). The opener is written
  // before the open so the pane's first drawing shows it.
  on('command.run', { command: 'ui-sampler-dialog' }, async ($, e) => {
    noteCall('command.run')
    const where = `isFullscreen: ${e.presentation.isFullscreen}、${e.presentation.columns} 桁`
    await update($, { ...ECHO, id: 'DialogPane:openedBy' }, () => `/ui-sampler-dialog（command.run、presentation: ${where}）`)
    const opened = await $.ui.open(DIALOG_OPEN)
    const result = opened.isPlaced ? 'isPlaced: true' : `isPlaced: false、reason: ${opened.reason}`
    await update($, { ...ECHO, id: 'DialogPane:openResult' }, () => result)
    return { text: `[command.run] /ui-sampler-dialog で [DialogPane] を開きました（${result}、presentation の ${where}）` }
  })

  // registerValues, then registerElements, before registerPane: all three hook the pane, and
  // the first registered is the outer link, so the values view answers 'values', the samples
  // view 'samples', and each passes the rest on to [Pane]
  registerValues(on)
  registerElements(on)
  registerPane(on)
  registerDialog(on)
  registerEngineLines(on)
  registerTranscript(on)
  registerAsks(on)
  registerEvents(on)
}
