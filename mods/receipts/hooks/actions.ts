// What the mod does on its own: find claims, ask, run a command, tell Claude.
import type { EngineInterface } from 'claude-code'

import type { Claim, RawClaim } from '../types'
import {
  MODEL_PROMPT,
  checkClaim,
  clip,
  looksCheckable,
  parseModelClaims,
  ruleClaims,
  statusFor,
} from './check'
import {
  addStep,
  changeClaims,
  readBusy,
  readClaims,
  readMeta,
  readSteps,
  setBusy,
  setPicked,
  tick,
} from './state'

export const MODEL = 'claude-haiku-5-5'

/** Finds the checkable sentences in an answer: one small model call, the rules when it fails. */
export async function findClaims($: EngineInterface, answer: string): Promise<RawClaim[]> {
  if (!looksCheckable(answer)) return []
  try {
    const reply = await $.model.complete({ model: MODEL, prompt: MODEL_PROMPT(answer), maxTokens: 700, timeoutMs: 20000 })
    if (reply.isAnswered) {
      const parsed = parseModelClaims(reply.text, answer)
      if (parsed) return parsed
    }
  } catch {
    // fall through to the rules
  }
  return ruleClaims(answer)
}

async function refresh($: EngineInterface, id: string): Promise<Claim[]> {
  const steps = await readSteps($)
  const meta = await readMeta($)
  return changeClaims($, list =>
    list.map(c => (c.id === id ? { ...checkClaim(c.raw, steps, meta.turnFrom, c.id), isSkipped: c.isSkipped } : c)),
  )
}

const tail = (text: string): string =>
  text
    .split('\n')
    .map(l => l.trimEnd())
    .filter(Boolean)
    .slice(-6)
    .map(l => clip(l, 160))
    .join('\n')

/**
 * Runs the command a claim rests on, records it, and settles the claim.
 * When it fails, Claude is told: a prompt goes in, which starts a turn once the session is idle.
 */
export async function runClaim($: EngineInterface, id: string): Promise<void> {
  if (await readBusy($)) return
  const claim = (await readClaims($)).find(c => c.id === id)
  const cmd = claim?.cmd
  if (!claim || !cmd) return
  await setBusy($, true)
  try {
    const machine = await $.session.machine()
    const argv = machine.sysname === 'Windows_NT' ? ['cmd', '/c', cmd] : ['sh', '-c', cmd]
    $.ui.toast(`Running ${clip(cmd, 50)}`)
    const start = await tick($)
    let exit = 1
    let out = ''
    try {
      const res = await $.process.run(argv, { timeoutMs: 600000 })
      exit = res.exitCode
      out = tail(`${res.stdout}\n${res.stderr}`)
    } catch (error) {
      out = clip(error instanceof Error ? error.message : String(error), 200)
    }
    const end = await tick($)
    await addStep($, { id: `s${end}`, kind: 'run', start, end, cmd, exit, out, by: 'Receipts' })
    const claims = await refresh($, id)
    await setPicked($, `c:${id}`)
    const now = claims.find(c => c.id === id)
    $.ui.status(`Receipts: ${statusFor(claims)}`)
    if (now?.status === 'ok') {
      $.ui.toast(`${clip(cmd, 40)} passes`)
      return
    }
    await $.prompt.submit({
      text: [
        `Receipts ran \`${cmd}\` after your last edit, because your answer said “${claim.text}”.`,
        `It failed (exit ${exit}):`,
        out || '(no output)',
        'Please fix it, then run it again.',
      ].join('\n'),
    })
  } finally {
    await setBusy($, false)
  }
}

export async function skipClaim($: EngineInterface, id: string): Promise<void> {
  const list = await changeClaims($, all => all.map(c => (c.id === id ? { ...c, isSkipped: true as const } : c)))
  $.ui.status(`Receipts: ${statusFor(list)}`)
}

/** Two choices, in the engine's own question: run the command now, or skip. */
export async function offerRun($: EngineInterface, id: string): Promise<void> {
  const claim = (await readClaims($)).find(c => c.id === id)
  if (!claim?.cmd || claim.status === 'ok' || claim.isSkipped) return
  let choice: string
  try {
    choice = await $.ui.ask(`No proof yet for “${clip(claim.text, 70)}”. Run ${clip(claim.cmd, 50)} now?`, [
      'Run it now',
      'Skip',
    ])
  } catch {
    return
  }
  if (choice === 'Run it now') await runClaim($, id)
  else await skipClaim($, id)
}
