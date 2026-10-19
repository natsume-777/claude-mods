// Reading a thread's requests back from its transcript, which records every response with its
// message id and the exact 5m / 1h split of its cache writes. The live tally (turn.step) is a
// provisional figure until then.
//
// A subagent is read back once, when it finishes (classic.SubagentStop). The main thread is read
// back at the end of each main turn (classic.Stop) and before [書き出す]; its transcript path
// comes from the classic hooks (register.js keeps it in $.state `transcriptPath`). Where those
// hooks do not run, or the file is over MAX_TRANSCRIPT_BYTES or cannot be read, the live values
// stay and $.state `mainSource` says why.

import { parseThread } from './aggregate.js'
import { MAX_TRANSCRIPT_BYTES, parseJsonl, replaceThread, mergeMain, transcriptRequests } from './ledger.js'
import { update } from 'claude-code'

// The state this file reads and writes (declared in types/index.d.ts)
const REQUESTS = { plugin: 'usage-ledger', key: 'requests' }
const THREADS = { plugin: 'usage-ledger', key: 'threads' }
const TRANSCRIPT = { plugin: 'usage-ledger', key: 'transcriptPath' }
const MAIN_SOURCE = { plugin: 'usage-ledger', key: 'mainSource' }

// A transcript's requests for `thread`, or why there are none: { requests } | { reason }
async function readTranscript($, path, thread) {
  if (typeof path !== 'string' || path === '') return { reason: 'noPath' }
  try {
    const stat = await $.fs.stat(path)
    if (typeof stat?.size === 'number' && stat.size > MAX_TRANSCRIPT_BYTES) return { reason: 'tooLarge' }
  } catch {
    return { reason: 'unreadable' }
  }
  let text
  try {
    text = await $.fs.read(path)
  } catch {
    return { reason: 'unreadable' }
  }
  return { requests: transcriptRequests(parseThread(parseJsonl(text)).requests, thread) }
}

/** Keeps the main transcript's path from a classic hook's input; a subagent's event is skipped. */
export async function notePath($, e) {
  if (e?.agent_id) return
  const path = e?.transcript_path
  if (typeof path !== 'string' || path === '') return
  const { value } = await $.state.get(TRANSCRIPT)
  if (value !== path) await $.state.set(TRANSCRIPT, path)
}

/** A finished subagent: its live requests replaced by its transcript's (left when unreadable). */
export async function backfillSubagent($, agentId, path) {
  const got = await readTranscript($, path, agentId)
  if (!got.requests || got.requests.length === 0) return false
  await update($, REQUESTS, (list) => replaceThread(list, agentId, got.requests))
  await update($, THREADS, (threads) => ({ ...(threads ?? {}), [agentId]: { ...(threads ?? {})[agentId], isBackfilled: true } }))
  return true
}

/**
 * The main thread: its requests replaced by its transcript's, the live ones it does not have
 * yet kept (ledger.js mergeMain). `mainSource` records when it last worked, or why not.
 * Returns whether it was read back.
 */
export async function backfillMain($) {
  const { value: path } = await $.state.get(TRANSCRIPT)
  const got = await readTranscript($, path, 'main')
  const { value: prev } = await $.state.get(MAIN_SOURCE)
  if (got.requests && got.requests.length > 0) {
    await update($, REQUESTS, (list) => mergeMain(list, got.requests))
    await $.state.set(MAIN_SOURCE, { backfilledAt: await $.clock.now(), requests: got.requests.length, reason: null })
    return true
  }
  const reason = got.reason ?? 'empty'
  // Written only when it changes, so a failed read does not redraw the pane each time; with no
  // path there is nothing to record (mainSourceOf tells that from the missing path)
  if (reason !== 'noPath' && prev?.reason !== reason) {
    await $.state.set(MAIN_SOURCE, { backfilledAt: prev?.backfilledAt ?? null, requests: prev?.requests ?? 0, reason })
  }
  return false
}
