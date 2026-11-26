import type { EngineInterface, Register } from 'claude-code'

import type { Step } from '../types'
import { findClaims, offerRun } from './actions'
import { checkClaim, checkHelper, clip, lineFor, statusFor } from './check'
import {
  addHelper,
  addStep,
  addTask,
  readMeta,
  readSteps,
  readTasks,
  resetRecord,
  setClaims,
  setMeta,
  setPicked,
  tick,
} from './state'
import { plain, readData, rich } from './view'

const PANE = 'receipts'
const OPEN = { id: PANE, title: 'Receipts' }

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const lineCount = (s: string): number => (s ? s.split('\n').length : 0)
const edited = (minus: string, plus: string): string[] => [
  ...minus.split('\n').filter(Boolean).slice(0, 2).map(l => `- ${clip(l.trim(), 100)}`),
  ...plus.split('\n').filter(Boolean).slice(0, 2).map(l => `+ ${clip(l.trim(), 100)}`),
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'receipts', description: 'Show what Claude said it did, next to what happened' })
    await setMeta($, { cwd: e.cwd })
    return next(e)
  })

  // A /clear starts the record over: what happened before it can no longer prove anything.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetRecord($)
      $.ui.status(undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'receipts' }, async $ => {
    await $.ui.open(OPEN)
    return { text: 'Receipts pane opened.' }
  })

  // The record: every tool call that really ran, with how it ended.
  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const agent = (e as { agentId?: string }).agentId
    const start = await tick($)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    try {
      const end = await tick($)
      const step = stepOf(tool, input, `s${end}`, start, end, agent, ran.isError === true, ran.text ?? '')
      if (step) await addStep($, step)
    } catch {
      // A record that fails to write must never change what the tool did.
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await setMeta($, { turnFrom: await tick($), hasAnswer: false })
    return next(e)
  })

  // What each helper was asked to do, so its report can be read against it.
  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const id = (spawned as { agentId?: string }).agentId
    if (id) await addTask($, id, clip(e.prompt, 2000))
    return spawned
  }).catch(($, e, next) => next(e))

  // The end of an answer: find the claims, check each, speak up only for one with no proof.
  on('turn.complete', async ($, e, next) => {
    const answered = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return answered
    try {
      const raws = await findClaims($, e.answer)
      const steps = await readSteps($)
      const meta = await readMeta($)
      const claims = raws.map((raw, i) => checkClaim(raw, steps, meta.turnFrom, `c${i + 1}`))
      await setClaims($, claims)
      await setMeta($, { hasAnswer: true })
      const open = claims.find(c => c.status !== 'ok')
      await setPicked($, open ? `c:${open.id}` : '')
      if (!claims.length) {
        $.ui.status(undefined)
        return answered
      }
      $.ui.status(`Receipts: ${statusFor(claims)}`)
      const line = lineFor(claims)
      if (line === undefined) return answered
      const ask = claims.find(c => c.status === 'none' && c.cmd)
      if (ask) $.clock.after(300, () => void offerRun($, ask.id))
      return { ...answered, text: line }
    } catch {
      return answered
    }
  })

  // A helper's report, read before Claude reads it.
  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('agent.report', async ($, e, next) => {
    const reported = await next(e)
    if (reported.consumed !== undefined || e.status !== 'completed') return reported
    try {
      const steps = await readSteps($)
      const tasks = await readTasks($)
      const meta = await readMeta($)
      const check = checkHelper(e.agentId, e.text, tasks[e.agentId] ?? '', steps, await onDisk($, meta.cwd))
      await addHelper($, check)
      const at = await tick($)
      await addStep($, { id: `h${at}`, kind: 'helper', agent: e.agentId, start: at, end: at, query: clip(tasks[e.agentId] ?? e.subagentType, 80) })
      if (!check.note) return reported
      return { text: `${reported.text}\n\nReceipts: ${check.note}`, review: reported.review, warning: reported.warning }
    } catch {
      return reported
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const data = await readData($)
    if (e.surface === 'terminal') return plain($, $.ui.resolve(e), data)
    return rich($, $.ui.resolve(e), data)
  })
}

/** The files the version control diff shows changed, when the working copy has one. */
async function onDisk($: EngineInterface, cwd: string): Promise<{ root: string; files: string[] } | undefined> {
  if (!cwd) return undefined
  try {
    const found = await $.vcs.detect({ path: cwd })
    if (!found) return undefined
    const diff = await $.vcs.diff({ path: found.root, vcs: found.vcs, base: 'head', isStatOnly: true })
    return diff.files ? { root: found.root, files: diff.files.map(f => f.path) } : undefined
  } catch {
    return undefined
  }
}

/** Turns one tool call into a step of the record, or nothing when it is not worth a step. */
const stepOf = (
  tool: string,
  input: Record<string, unknown>,
  id: string,
  start: number,
  end: number,
  agent: string | undefined,
  isError: boolean,
  out: string,
): Step | undefined => {
  const base = { id, start, end, ...(agent ? { agent } : {}) }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = text(input.command).trim()
    if (!cmd) return undefined
    const lastLines = out.split('\n').map(l => l.trimEnd()).filter(Boolean).slice(-6).map(l => clip(l, 160)).join('\n')
    if (input.run_in_background === true) return { ...base, kind: 'run', cmd, out: 'Started in the background.' }
    const code = /exit code:?\s*(-?\d+)/i.exec(out)
    return { ...base, kind: 'run', cmd, exit: isError ? Number(code?.[1] ?? 1) : 0, out: lastLines }
  }
  // A call that failed changed nothing, so it is no proof.
  if (isError && tool !== 'Bash' && tool !== 'PowerShell') return undefined
  if (tool === 'Edit') {
    const minus = text(input.old_string)
    const plus = text(input.new_string)
    return { ...base, kind: 'edit', file: text(input.file_path), add: lineCount(plus), del: lineCount(minus), diff: edited(minus, plus) }
  }
  if (tool === 'MultiEdit') {
    const list = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
    const minus = list.map(x => text(x.old_string)).join('\n')
    const plus = list.map(x => text(x.new_string)).join('\n')
    return { ...base, kind: 'edit', file: text(input.file_path), add: lineCount(plus), del: lineCount(minus), diff: edited(minus, plus) }
  }
  if (tool === 'Write') {
    const body = text(input.content)
    return { ...base, kind: 'edit', file: text(input.file_path), add: lineCount(body), del: 0, diff: edited('', body) }
  }
  if (tool === 'NotebookEdit') {
    const body = text(input.new_source)
    return { ...base, kind: 'edit', file: text(input.notebook_path), add: lineCount(body), del: 0, diff: edited('', body) }
  }
  if (tool === 'Read') return { ...base, kind: 'read', file: text(input.file_path) }
  if (tool === 'Grep' || tool === 'Glob') return { ...base, kind: 'search', query: text(input.pattern) }
  return undefined
}
