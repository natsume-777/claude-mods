// The two dialogs that ask the person. The AskUserQuestion dialog is a render site:
// [AskUserQuestion] marks its question text and lets the engine draw it. The permission
// dialog is drawn by the engine alone (its answer authorises an action); a plugin only adds
// a line under it, which [$.ui.notice] does from a tool.call hook on Bash.

import { noteCall, noteProps, noteResult, toggleValue } from './sites.js'
import { noteInvalidate } from './diag.js'
import { redrawFor, paneLists } from './redraw.js'
import { read } from 'claude-code'

// The state this file reads (declared in types/index.d.ts): one switch per site id
const TOGGLES = { plugin: 'ui-sampler', key: 'toggles' }

// Counts the call and keeps the props; redraws the pane only when it shows what changed
// (redraw.js)
function noteRender($, id, e) {
  const isNew = noteCall(id, e.surface)
  const isChanged = noteProps(id, e)
  const why = redrawFor(id, { isNew, isChanged }, Date.now())
  if (!why) return
  noteInvalidate(`${id} の${why === 'first' ? '初回描画' : ' props が変わった'}`)
  $.ui.invalidate('ui.render')
}

// Redraws the pane for a new result line, when the pane lists the site
function redrawResult($, id) {
  if (!paneLists(id)) return
  noteInvalidate(`${id} の結果が変わった`)
  $.ui.invalidate('ui.render')
}

// Reading the switch while drawing subscribes the dialog, so a press in the pane redraws it
async function isOn($, id) {
  return toggleValue(id, await read($, { ...TOGGLES, id }))
}

/**
 * One entry of the tool's `questions` with its question text marked. The label goes on the
 * text, not on `header`: the tool's schema caps `header` at 12 characters, and a rewrite that
 * breaks the schema is drawn as the original.
 */
function markQuestion(question) {
  if (question === null || typeof question !== 'object' || typeof question.question !== 'string') return question
  return { ...question, question: '[AskUserQuestion] ' + question.question }
}

/** A command cut to one short line for the notice and the pane. */
function clip(command) {
  const line = String(command ?? '').replace(/\s+/g, ' ').trim()
  return line.length > 40 ? line.slice(0, 40) + '…' : line
}

export function registerAsks(on) {
  // ===== [AskUserQuestion] ui.render { component: 'AskUserQuestion' } =====
  // Raised both for Claude's AskUserQuestion calls and for $.ui.ask (the [$.ui.ask]
  // button in the main pane's dialogs view), which runs as a tool.call of AskUserQuestion
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    noteRender($, 'AskUserQuestion', e)
    if (!(await isOn($, 'AskUserQuestion'))) return next(e)
    const questions = Array.isArray(e.props.questions) ? e.props.questions.map(markQuestion) : e.props.questions
    return next({ ...e, props: { ...e.props, questions } })
  })

  // ===== [$.ui.notice] tool.call { tool: 'Bash' } → $.ui.notice(e.tool_use_id, text) =====
  // Called before next(e), as the type declarations' example does, so the line is in place
  // when the permission dialog below opens; the engine removes it when the call resolves.
  // A Bash call that needs no permission opens no dialog, and the line has nowhere to show.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await isOn($, '$.ui.notice'))) return next(e)
    noteCall('$.ui.notice')
    const command = clip(e.command)
    let called
    try {
      $.ui.notice(e.tool_use_id, `[$.ui.notice] ui-sampler が許可ダイアログの下に足した行です（${command}）`)
      called = `呼んだ（tool_use_id: ${e.tool_use_id}、コマンド: ${command}）`
    } catch (error) {
      called = `エラー: ${String(error?.message ?? error)}（コマンド: ${command}）`
    }
    noteResult('$.ui.notice', called + '。実行を待っている')
    redrawResult($, '$.ui.notice')

    const ran = await next(e)
    const outcome =
      ran.deny !== undefined ? `断られた（deny: ${ran.deny}）` : ran.isError === true ? 'エラーで終わった' : '実行された'
    noteResult('$.ui.notice', `${called}。その後の呼び出し: ${outcome}`)
    redrawResult($, '$.ui.notice')
    return ran
  })
}
