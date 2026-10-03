// Engine events that are not drawings: how the slash commands are described in the typeahead
// and /help, the end of a turn, and the dim suggestion in the prompt box. Each hook counts its
// call and keeps the input it received (the pane lists it in the [詳細] card), then passes
// `next(e)` on unchanged when its site is switched off in the pane. All are off by default.
// The $.prompt calls ([$.prompt.suggest] [$.prompt.fill] [$.prompt.read]) are the pane's
// buttons, in pane.js.

import { noteCall, noteEvent, toggleValue } from './sites.js'
import { noteInvalidate } from './diag.js'
import { redrawFor } from './redraw.js'
import { read } from 'claude-code'

// The state this file reads (declared in types/index.d.ts): one switch per site id
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }

// Counts the call and keeps the input; redraws the pane only when it shows what changed
// (redraw.js)
function noteEventCall($, id, e) {
  const isNew = noteCall(id)
  const isChanged = noteEvent(id, e)
  const why = redrawFor(id, { isNew, isChanged }, Date.now())
  if (!why) return
  noteInvalidate(`${id} の${why === 'first' ? '初回の呼び出し' : '受け取った e が変わった'}`)
  $.ui.invalidate('ui.render')
}

async function isOn($, id) {
  return toggleValue(id, await read($, { ...TOGGLES, id }))
}

// ===== [command.describe] the description of /ui-sampler and /ui-sampler-dialog =====
// Shared by the two hooks below, one per command (their matchers are literals so `plugin
// validate` can list them). The engine caches the answer for the session; the pane's switch
// asks it again with $.ui.invalidate('command.describe').
async function describeCommand($, e, next) {
  noteEventCall($, 'command.describe', e)
  if (!(await isOn($, 'command.describe'))) return next(e)
  return next({ ...e, description: '[command.describe] ' + e.description })
}

/** `3.2 秒`, from milliseconds. */
const seconds = ms => `${(ms / 1000).toFixed(1)} 秒`

/** A turn's token counts in one phrase, or a note that none came. */
function usagePhrase(usage) {
  if (!usage) return 'usage なし'
  return `入力 ${usage.input_tokens}・出力 ${usage.output_tokens}・キャッシュ読み ${usage.cache_read_input_tokens} トークン、${usage.model}`
}

export function registerEvents(on) {
  // ===== [command.describe] on('command.describe', { command: 'ui-sampler' }) =====
  on('command.describe', { command: 'ui-sampler' }, async ($, e, next) => describeCommand($, e, next))

  // ===== [command.describe] on('command.describe', { command: 'ui-sampler-dialog' }) =====
  on('command.describe', { command: 'ui-sampler-dialog' }, async ($, e, next) => describeCommand($, e, next))

  // ===== [turn.complete] on('turn.complete') =====
  // A text other than the answer is shown beneath the answer; the transcript's record keeps
  // the answer. A subagent's turn (agentId) is passed on as it came: its text is what the
  // caller of the subagent reads.
  on('turn.complete', async ($, e, next) => {
    noteEventCall($, 'turn.complete', e)
    if (e.agentId !== undefined || !(await isOn($, 'turn.complete'))) return next(e)
    const result = await next(e)
    const line = `[turn.complete] ui-sampler が足した行（reason: ${e.reason}、${seconds(e.durationMs)}、${usagePhrase(e.usage)}）`
    return { ...result, text: line }
  })

  // ===== [prompt.suggest] on('prompt.suggest') =====
  // The engine's guess after a turn, or another plugin's $.prompt.suggest; this mod's own
  // [$.prompt.suggest] does not come through here
  on('prompt.suggest', async ($, e, next) => {
    noteEventCall($, 'prompt.suggest', e)
    if (!(await isOn($, 'prompt.suggest'))) return next(e)
    return next({ ...e, text: '[prompt.suggest] ' + e.text })
  })
}
