import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { CrewTask } from '../types'
import { baseCostOf, costOf, isCheaper, isCheckCommand, kindOfStep, parsePlan, parseSignoff } from './crew'
import { stripSvg, trackSvg } from './view'
import { DEFAULT_RECIPE } from './crew'

const FABLE = 'claude-fable-5-2'
const OPUS = 'claude-opus-5-5'
const SESSION_MODEL = 'claude-opus-5-5'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

const PANE = {
  plugin: 'crew',
  component: 'Pane',
  requestId: 'crew',
  props: {
    title: 'Crew',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

type Use = { name: string; input: unknown }
type Seen = { model: string; effort: string | number | undefined }

/** The engine beneath the mod: records what model each step was sent on and answers with real-looking usage. */
function engine(on: On, state: { uses: Use[]; seen: Seen[]; bashFails: boolean; prompts: string[]; completes: string[]; plan: string; verdict: string }) {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'crew' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', () => ({ value: undefined }) as never)
  on('classic.UserPromptSubmit', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    state.prompts.push(e.text)
    return { text: e.text }
  })
  on('model.complete', (_, e) => {
    state.completes.push(`${e.model}\n${e.prompt}`)
    return {
      value: {
        isAnswered: true as const,
        text: state.verdict,
        usage: { input_tokens: 800, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'ExitPlanMode') return { result: { plan: state.plan, isAgent: false } }
    if (e.tool === 'Bash' && state.bashFails) return { result: { stdout: '', stderr: 'error', interrupted: false }, isError: true as const }
    return { result: {} }
  })
  on('turn.step', async function* (_, e) {
    state.seen.push({ model: e.model, effort: e.effort })
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: state.uses,
      stopReason: 'tool_use' as const,
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0, model: e.model },
    }
  })
}

const fresh = () => ({
  uses: [] as Use[],
  seen: [] as Seen[],
  bashFails: false,
  prompts: [] as string[],
  completes: [] as string[],
  plan: '1. Add the field\n2. Show it in the summary\n3. Save it with the order',
  verdict: '{"missing":[2],"note":"The summary was never touched."}',
})

async function runStep($: any, index: number, uses: Use[], state: ReturnType<typeof fresh>) {
  state.uses = uses
  const s = $.turn.step({ turnId: 't1', index, model: SESSION_MODEL, messageCount: 3 })
  for await (const _ of s) void _
  return s.result
}

/** The pane's words, the way a person reads the task's state. */
async function words($: any, surface: 'terminal' | 'desktop', re: RegExp) {
  const ui = await $.ui.mount({ ...PANE, surface })
  const hit = await ui.find({ type: 'Text', text: re })
  await ui.unmount()
  return hit?.text as string | undefined
}

/** One whole task: plan, approve, build, a failing check twice, the rescue, hand-back. */
async function theTask($: any, state: ReturnType<typeof fresh>) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.classic.UserPromptSubmit({ prompt: 'add a gift note to checkout', permission_mode: 'plan' })
  await $.turn.start({ text: 'add a gift note to checkout', turnId: 't1' })
  await runStep($, 0, [{ name: 'Read', input: { file_path: '/repo/address.tsx' } }], state) // plan
  await $.tool.call({ tool: 'ExitPlanMode' }) // approved
  await runStep($, 1, [{ name: 'Edit', input: { file_path: '/repo/address.tsx' } }], state) // build
  await runStep($, 2, [{ name: 'Read', input: { file_path: '/repo/summary.tsx' } }], state) // build, reads
  await runStep($, 3, [{ name: 'Bash', input: { command: 'npm run build' } }], state) // look up, then runs a check
  state.bashFails = true
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  await runStep($, 4, [{ name: 'Edit', input: { file_path: '/repo/order-types.ts' } }], state)
  await $.tool.call({ tool: 'Bash', command: 'npm run build' }) // second failure in a row
  await runStep($, 5, [{ name: 'Edit', input: { file_path: '/repo/schema/order.yaml' } }], state) // rescue
  state.bashFails = false
  await runStep($, 6, [{ name: 'Bash', input: { command: 'npm run build' } }], state) // handed back
}

// ---------- Stage detection ----------

test('a step is told apart by what it did', () => {
  expect(isCheckCommand('npm run lint')).toBe(true)
  expect(isCheckCommand('npx tsc --noEmit')).toBe(true)
  expect(isCheckCommand('ls -la')).toBe(false)
  expect(kindOfStep([{ name: 'Bash', input: { command: 'npm run build' } }])).toBe('check')
  expect(kindOfStep([{ name: 'Edit', input: { file_path: 'a.ts' } }])).toBe('edit')
  expect(kindOfStep([{ name: 'Read', input: {} }, { name: 'Grep', input: {} }])).toBe('read')
  expect(kindOfStep([{ name: 'Bash', input: { command: 'git status' } }])).toBe('read')
  expect(kindOfStep([{ name: 'ExitPlanMode', input: {} }])).toBe('plan-exit')
  expect(kindOfStep([])).toBe('other')
})

test('the plan is read from numbered lines, and sign-off answers are read strictly', () => {
  expect(parsePlan('Plan\n1. Add the field\n2) Show it\n- [ ] Save it\nnotes')).toEqual(['Add the field', 'Show it', 'Save it'])
  expect(parseSignoff('sure: {"missing":[2,9,2],"note":"x"}', 3)).toEqual({ missing: [2], note: 'x' })
  expect(parseSignoff('nothing here', 3)).toBeNull()
  expect(isCheaper(OPUS, FABLE)).toBe(true)
  expect(isCheaper(FABLE, FABLE)).toBe(false)
})

test('cost uses the reported tokens and says nothing for a model it has no price for', () => {
  const u = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0 }
  const crew = costOf(OPUS, u, false)
  const base = baseCostOf(FABLE, u, false)
  expect(crew && base && crew.total < base).toBe(true)
  expect(costOf('claude-mystery-1', u, false)).toBeNull()
  // A hand-off re-reads the whole chat as a fresh write, so it costs more than the same step without one.
  const hand = costOf(OPUS, u, true)
  expect(hand && crew && hand.total > crew.total && hand.hand > 0).toBe(true)
})

// ---------- Practice mode changes nothing ----------

test('practice mode never changes a model, but records what it would have picked', async ($, on) => {
  const state = fresh()
  engine(on, state)
  await theTask($, state)

  // Every request went out on the session's own model, with no effort set.
  expect(state.seen.length).toBe(7)
  expect(state.seen.every(s => s.model === SESSION_MODEL && s.effort === undefined)).toBe(true)
  // No sign-off call, no nudge row: nothing was spent or said.
  expect(state.completes.length).toBe(0)

  // It still counted the four hand-offs it would have made, and says so.
  expect(await words($, 'desktop', /Hand-offs between models: 4/)).toBeDefined()
  expect(await words($, 'desktop', /Practice mode: nothing is switched/)).toBeDefined()
  expect(await words($, 'terminal', /With the crew: .* \(estimate\)/)).toBeDefined()
})

// ---------- On mode switches only at hand-offs ----------

test('on mode switches models only at hand-offs', { options: { mode: 'on' } }, async ($, on) => {
  const state = fresh()
  engine(on, state)
  await theTask($, state)

  const m = state.seen.map(s => s.model)
  // 0 plan on the best model; 1-3 build and look up stay on one model; 4 is the rescue; 5 and 6 hand back.
  expect(m[0]).toBe(FABLE)
  expect(m.slice(1, 4)).toEqual([OPUS, OPUS, OPUS])
  expect(state.seen[0]?.effort).toBe('high')
  expect(state.seen[1]?.effort).toBe('medium')
  // The step after a read-only step asks for Look up's lower effort on the same model.
  expect(state.seen[3]?.effort).toBe('low')

  // Between two steps the model changes only at a hand-off: plan start (session model to best), plan approved, rescue, hand back.
  const at = [SESSION_MODEL, ...m].flatMap((x, i, all) => (i > 0 && x !== all[i - 1] ? [i - 1] : []))
  expect(at).toEqual([0, 1, 5, 6])
  expect(await words($, 'desktop', /Hand-offs between models: 4/)).toBeDefined()
})

test('the same check failing twice on a cheaper model gives the best model one step, then hands back', { options: { mode: 'on' } }, async ($, on) => {
  const state = fresh()
  engine(on, state)
  await theTask($, state)

  const m = state.seen.map(s => s.model)
  // Failed once after step 3: step 4 is still the builder. Failed twice after step 4: step 5 is the best model, step 6 is the builder again.
  expect(m[4]).toBe(OPUS)
  expect(m[5]).toBe(FABLE)
  expect(m[6]).toBe(OPUS)
  // plan start, plan approved, rescue, hand back
  expect(await words($, 'desktop', /Hand-offs between models: 4/)).toBeDefined()
})

test('a check that fails once, then passes, does not call the best model', { options: { mode: 'on' } }, async ($, on) => {
  const state = fresh()
  engine(on, state)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  state.bashFails = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  state.bashFails = false
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  state.bashFails = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await runStep($, 0, [], state)
  expect(state.seen[0]?.model).toBe(OPUS)
})

// ---------- Sign-off ----------

test('sign-off finds a missing step and the person can send Claude back', { options: { mode: 'on' } }, async ($, on) => {
  const state = fresh()
  engine(on, state)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.classic.UserPromptSubmit({ prompt: 'add a gift note', permission_mode: 'plan' })
  await $.turn.start({ text: 'add a gift note', turnId: 't1' })
  await $.tool.call({ tool: 'ExitPlanMode' })
  await runStep($, 1, [{ name: 'Edit', input: { file_path: '/repo/address.tsx' } }], state)
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

  // One call on the best model, given the plan and the files changed.
  expect(state.completes.length).toBe(1)
  expect(state.completes[0]).toContain(FABLE)
  expect(state.completes[0]).toContain('Show it in the summary')
  expect(state.completes[0]).toContain('address.tsx')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'leave' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(state.prompts.length).toBe(1)
  expect(state.prompts[0]).toContain('step 2')
  await ui.unmount()
  expect(await words($, 'desktop', /Sent Claude back/)).toBeDefined()
})

test('practice mode does not sign off', async ($, on) => {
  const state = fresh()
  engine(on, state)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.classic.UserPromptSubmit({ prompt: 'add a gift note', permission_mode: 'plan' })
  await $.turn.start({ text: 'add a gift note', turnId: 't1' })
  await $.tool.call({ tool: 'ExitPlanMode' })
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(state.completes.length).toBe(0)
  expect(await words($, 'terminal', /sign-off would run here/)).toBeDefined()
})

// ---------- The recipe ----------

test('/crew set changes the recipe and keeps it for this repo', async ($, on) => {
  const state = fresh()
  engine(on, state)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ ...RUN, command: 'crew', args: 'set build sonnet medium' })
  expect(out.text).toContain('Build: Sonnet 5.5, medium effort')
  // Look up follows Build: it never has a model of its own.
  expect(out.text).toContain('Look up: Sonnet 5.5, low effort')
  // A new session in the same repo starts from the saved recipe.
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  expect(await words($, 'terminal', /Build: Sonnet 5.5, medium effort/)).toBeDefined()
  const bad = await $.command.run({ ...RUN, command: 'crew', args: 'set build banana' })
  expect(bad.text).toContain('Say which model')
})

// ---------- The pane ----------

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane draws a finished task on ${surface}`, { options: { mode: 'on' } }, async ($, on) => {
    const state = fresh()
    engine(on, state)
    await theTask($, state)
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /On: the crew is switching models/ }))?.text).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Hand-offs between models: 4/ }))?.text).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Build: Opus 5.5|Opus 5.5/ })).toBeDefined()
    if (surface === 'desktop') {
      // Stage track and the step strip are drawings; the recipe rows are buttons.
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
      expect(await ui.find({ key: 'stage-build' })).toBeDefined()
    }
    await ui.unmount()
  })
}

test('the pane in practice mode says nothing is switched, and a press changes the recipe', async ($, on) => {
  const state = fresh()
  engine(on, state)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Practice mode: nothing is switched/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /No plan yet/ }))?.text).toBeDefined()
  await ui.press({ key: 'stage-plan' })
  await ui.unmount()
  // Fable is first in the cycle, so one press moves Plan to the next model; a new session keeps it.
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  expect(await words($, 'terminal', /Plan: Opus 5.5, high effort/)).toBeDefined()
})

test('the drawings are well-formed SVG with an entry for every step', () => {
  const steps = [0, 1, 2].map(n => ({
    n,
    stage: 'build' as const,
    label: 'x',
    picked: OPUS,
    ran: null,
    isHelper: false,
    isHandoff: n === 1,
    isRescue: false,
    crew: n === 2 ? null : 0.1,
    base: n === 2 ? null : 0.3,
    hand: n === 1 ? 0.05 : 0,
  }))
  const svg = stripSvg(steps, 'shadow')
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  // A step with no usage report is a hollow mark, not a made-up bar.
  expect((svg.match(/stroke-dasharray="2 2"/g) ?? []).length).toBe(1)
  expect(trackSvg({ phase: 'idle', steps: [], signoff: { status: 'none', missing: [], note: '' } } as unknown as CrewTask, DEFAULT_RECIPE)).toContain('Sign-off')
})
