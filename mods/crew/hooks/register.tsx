import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CrewInfo, CrewRecipe, CrewStage, CrewStep, CrewTask } from '../types'
import { leaveIt, sendBack, changeRecipe } from './actions'
import {
  DEFAULT_RECIPE,
  EMPTY_TASK,
  FAMILIES,
  MODEL_IDS,
  STAGES,
  baseCostOf,
  checkKey,
  costOf,
  familyOf,
  filesOf,
  isCheaper,
  isCheckCommand,
  kindOfStep,
  labelOfStep,
  nameOf,
  newTask,
  normalise,
  parsePlan,
  parseSignoff,
  pickFor,
  recipeLines,
  signoffPrompt,
  type Usage,
} from './crew'
import { closeExample, drawPane } from './pane'


// Change a tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const taskA = atom({ plugin: 'crew', key: 'task' } as const, EMPTY_TASK as CrewTask, { shape: 'task-1' })
const recipeA = atom({ plugin: 'crew', key: 'recipe' } as const, DEFAULT_RECIPE as CrewRecipe, { shape: 'recipe-1' })
const infoA = atom({ plugin: 'crew', key: 'info' } as const, { mode: 'shadow', repo: '' } as CrewInfo, { shape: 'info-1' })

function setTask($: EngineInterface, f: (t: CrewTask) => CrewTask): Promise<CrewTask> {
  return update($, taskA, f)
}

const PANE = 'crew'
const MAX_STEPS = 300

type Api = EngineInterface

async function usdNow($: Api): Promise<number | null> {
  try {
    return (await $.session.usage()).cost?.usd ?? null
  } catch {
    return null
  }
}

/** The same family counts as the same model: an alias and a full id do not make a hand-off. */
const isSwitch = (from: string | null, to: string): boolean => {
  if (from === null) return false
  const a = familyOf(from)
  const b = familyOf(to)
  return a && b ? a !== b : from !== to
}

const asUsage = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model?: string } | null): Usage | null => u

const parseModel = (word: string): string | null => {
  const w = word.toLowerCase()
  const f = FAMILIES.find(x => w === x || w.startsWith(`${x}-`) || w.includes(`claude-${x}`))
  return f ? (w.startsWith('claude-') ? w : MODEL_IDS[f]) : null
}

// ---------- Task bookkeeping ----------
async function begin($: Api, text: string, isPlanMode: boolean) {
  const task = await read($, taskA)
  if (task.phase === 'idle' || task.phase === 'done') {
    const usd = await usdNow($)
    await setTask($, (t): CrewTask => newTask(t.id + 1, text, isPlanMode ? 'plan' : 'build', usd))
  } else if (isPlanMode && task.phase === 'build') {
    await setTask($, (t): CrewTask => ({ ...t, phase: 'plan', lastWasRead: false }))
  }
}

async function addStep($: Api, step: CrewStep, main: { files: string[]; lastMain: string; lastWasRead: boolean; clearRescue: boolean } | null) {
  const usd = await usdNow($)
  await setTask($, (t): CrewTask => ({
    ...t,
    steps: [...t.steps, { ...step, n: (t.steps.at(-1)?.n ?? 0) + 1 }].slice(-MAX_STEPS),
    hands: t.hands + (step.isHandoff ? 1 : 0),
    usdNow: usd ?? t.usdNow,
    ...(main
      ? {
          files: [...t.files, ...main.files].slice(-200),
          lastMain: main.lastMain,
          lastWasRead: main.lastWasRead,
          isEscalating: main.clearRescue ? false : t.isEscalating,
        }
      : {}),
  }))
}


export const register: Register = (on, options) => {
  const mode: 'shadow' | 'on' = options.mode === 'on' ? 'on' : 'shadow'
  const isOn = mode === 'on'

  // ---------- Start: the command, the saved recipe ----------
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'crew',
      description: 'Show the crew of models for this task and open its pane',
      argumentHint: '[set <stage> <model> [effort] | reset | back | leave]',
    })
    let recipe = DEFAULT_RECIPE
    try {
      const saved = (await $.store.get(`recipe:${e.cwd}`)) as CrewRecipe | undefined
      if (saved && STAGES.every(s => saved[s]?.model)) recipe = normalise(saved)
    } catch {
      // Start from the default recipe.
    }
    await update($, recipeA, () => recipe)
    await update($, infoA, () => ({ mode, repo: e.cwd }))
    await setTask($, () => newTask(0, '', 'idle', null))
    return next(e)
  })

  // ---------- /crew ----------
  on('command.run', { command: 'crew' }, async ($, e) => {
    const [word = '', a = '', b = '', c = ''] = e.args.trim().split(/\s+/)
    if (word === 'set') {
      const stage = STAGES.find(s => s === a.toLowerCase() || (a.toLowerCase() === 'lookup' && s === 'look') || (a.toLowerCase() === 'signoff' && s === 'sign'))
      const model = parseModel(b)
      if (!stage) return { text: `Say which stage: ${STAGES.join(', ')}. Example: /crew set build sonnet medium` }
      if (stage === 'look' && !['low', 'medium', 'high'].includes(b)) return { text: 'Look up always uses the Build model. Change its effort: /crew set look low' }
      if (stage !== 'look' && !model) return { text: `Say which model: ${FAMILIES.join(', ')}. Example: /crew set ${stage} sonnet` }
      const effort = (['low', 'medium', 'high'] as const).find(x => x === c.toLowerCase())
      await changeRecipe($, r =>
        normalise(
          stage === 'look'
            ? { ...r, look: { ...r.look, effort: b as 'low' | 'medium' | 'high' } }
            : { ...r, [stage]: { model: model as string, effort: stage === 'check' ? null : (effort ?? r[stage].effort) } },
        ),
      )
    } else if (word === 'reset') {
      await changeRecipe($, () => DEFAULT_RECIPE)
    } else if (word === 'back') {
      return { text: await sendBack($) }
    } else if (word === 'leave') {
      return { text: await leaveIt($) }
    }
    await $.ui.open({ id: PANE, title: 'Crew' })
    const recipe = await read($, recipeA)
    const head = isOn
      ? 'Crew is ON: it switches models at hand-offs.'
      : 'Crew is in practice mode: nothing is switched. It only shows which model it would have picked. To switch for real, set the mod option "Crew mode" to "on".'
    return { text: [head, ...recipeLines(recipe), 'Change one: /crew set build sonnet medium  |  /crew reset'].join('\n') }
  })

  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.agent_id === undefined && e.prompt.trim() !== '' && !e.prompt.startsWith('/crew')) await begin($, e.prompt, e.permission_mode === 'plan')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text.trim() !== '' && !e.text.startsWith('/crew')) await begin($, e.text, false)
    if (e.agentId === undefined) await closeExample($)
    return next(e)
  })

  // ---------- Every model request ----------
  on('turn.step', async function* ($, e, next) {
    const [recipe, task] = await Promise.all([read($, recipeA), read($, taskA)])
    const best = normalise(recipe).plan.model

    // A check helper: the model was set when it started. Count its steps.
    if (e.agentId !== undefined) {
      if (!task.helpers.includes(e.agentId)) return yield* next(e)
      const picked = isOn ? e.model : recipe.check.model
      const r = yield* next(e)
      const u = asUsage(r.usage)
      const ranModel = isOn ? (u?.model ?? picked) : picked
      const cost = u ? costOf(ranModel, u, false) : null
      const step: CrewStep = {
        n: 0,
        stage: 'check',
        label: 'Helper ran a check',
        picked,
        ran: u?.model ?? null,
        isHelper: true,
        isHandoff: false,
        isRescue: false,
        crew: cost?.total ?? null,
        base: u ? baseCostOf(best, u, false) : null,
        hand: 0,
      }
      await addStep($, step, null)
      return r
    }

    const pick = pickFor(task, recipe)
    const prev = task.lastMain ?? e.model
    const isHandoff = isSwitch(prev, pick.model)
    const sent = isOn ? { ...e, model: pick.model, ...(pick.effort ? { effort: pick.effort } : {}) } : e
    const r = yield* next(sent)

    const u = asUsage(r.usage)
    const priced = isOn ? (u?.model ?? pick.model) : pick.model
    const cost = u ? costOf(priced, u, isHandoff) : null
    const kind = kindOfStep(r.toolUses)
    const stage: CrewStage = pick.stage === 'plan' || pick.stage === 'sign' ? pick.stage : kind === 'check' ? 'check' : pick.stage
    const step: CrewStep = {
      n: 0,
      stage,
      label: labelOfStep(kind, r.toolUses, stage),
      picked: pick.model,
      ran: u?.model ?? null,
      isHelper: false,
      isHandoff,
      isRescue: pick.isRescue,
      crew: cost?.total ?? null,
      base: u ? baseCostOf(best, u, isHandoff) : null,
      hand: cost?.hand ?? 0,
    }
    await addStep($, step, {
      files: filesOf(r.toolUses),
      lastMain: pick.model,
      lastWasRead: kind === 'read',
      clearRescue: pick.isRescue,
    })
    return r
  })

  // ---------- Helpers for checks ----------
  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('agent.spawn', async ($, e, next) => {
    const task = await read($, taskA)
    const isCheck = (task.phase === 'build' || task.phase === 'plan') && e.subagentType !== 'Explore' && isCheckCommand(`${e.description} ${e.prompt.slice(0, 300)}`)
    if (!isCheck) return next(e)
    const recipe = await read($, recipeA)
    const sent = isOn && e.model === undefined ? { ...e, model: recipe.check.model } : e
    const res = await next(sent)
    const id = 'agentId' in res ? res.agentId : undefined
    if (id !== undefined) await setTask($, (t): CrewTask => ({ ...t, helpers: [...t.helpers, id].slice(-50), hands: t.hands + 1 }))
    return res
  }).catch(($, e, next) => next(e))

  // ---------- Plans and checks ----------
  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'EnterPlanMode' && e.agentId === undefined) {
      const ran = await next(e)
      await begin($, 'a plan', true)
      await setTask($, (t): CrewTask => ({ ...t, phase: t.phase === 'build' ? 'plan' : t.phase, lastWasRead: false }))
      return ran
    }

    if (e.tool === 'ExitPlanMode' && e.agentId === undefined) {
      const ran = await next(e)
      const result = 'result' in ran ? (ran.result as { plan?: string | null } | undefined) : undefined
      if ('deny' in ran && ran.deny !== undefined) return ran
      if ('isError' in ran && ran.isError) return ran
      // The person approved: the plan stage ends and the build stage begins.
      await setTask($, (t): CrewTask => ({ ...t, phase: 'build', plan: parsePlan(result?.plan), lastWasRead: false }))
      if (isOn) {
        await $.session
          .append({
            message: {
              type: 'user',
              content: [{ type: 'text', text: 'Crew: when you run lint, build or test commands, hand them to a helper agent, so a smaller model reads the long output.' }],
            },
          })
          .catch(() => undefined)
      }
      return ran
    }

    if ((e.tool === 'Bash' || e.tool === 'PowerShell') && isCheckCommand(e.command)) {
      const ran = await next(e)
      const failed = ('isError' in ran && ran.isError === true) || ('deny' in ran && ran.deny !== undefined)
      const key = checkKey(e.command)
      const recipe = await read($, recipeA)
      await setTask($, (t): CrewTask => {
        const count = failed ? (t.fails[key] ?? 0) + 1 : 0
        // The same check failed twice on a cheaper model: the best model takes the next step.
        const escalate = failed && count >= 2 && isCheaper(normalise(recipe).build.model, recipe.plan.model)
        return { ...t, fails: { ...t.fails, [key]: escalate ? 0 : count }, isEscalating: t.isEscalating || escalate }
      })
      return ran
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // ---------- Sign-off ----------
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return out
    const task = await read($, taskA)
    if (task.phase !== 'build') return out
    const hasChance = task.signoff.status === 'none' || task.signoff.status === 'sent'
    if (!hasChance) return out

    if (task.plan.length === 0) {
      await setTask($, (t): CrewTask => ({ ...t, phase: 'done', signoff: { status: 'none', missing: [], note: 'No plan was written, so there was nothing to check the work against.' } }))
      return out
    }
    const recipe = normalise(await read($, recipeA))
    if (!isOn) {
      await setTask($, (t): CrewTask => ({
        ...t,
        phase: 'done',
        hands: t.hands + (isSwitch(t.lastMain, recipe.sign.model) ? 1 : 0),
        signoff: { status: 'would', missing: [], note: `Practice mode: ${nameOf(recipe.sign.model)} would have compared the work with the plan here.` },
      }))
      return out
    }

    await setTask($, (t): CrewTask => ({ ...t, phase: 'sign' }))
    const answer = await $.model.complete({ model: recipe.sign.model, prompt: signoffPrompt(task), effort: recipe.sign.effort ?? 'high', timeoutMs: 60000 })
    const parsed = answer.isAnswered ? parseSignoff(answer.text, task.plan.length) : null
    const u = answer.usage as Usage | undefined
    const priced = u ? costOf(recipe.sign.model, u, false) : null
    const step: CrewStep = {
      n: 0,
      stage: 'sign',
      label: 'Compared the work with the plan',
      picked: recipe.sign.model,
      ran: recipe.sign.model,
      isHelper: false,
      isHandoff: isSwitch(task.lastMain, recipe.sign.model),
      isRescue: false,
      crew: priced?.total ?? null,
      base: u ? baseCostOf(recipe.plan.model, u, false) : null,
      hand: 0,
    }
    await addStep($, step, null)
    const status = parsed ? (parsed.missing.length ? 'missing' : 'ok') : 'unknown'
    const note = parsed ? parsed.note : 'The sign-off answer could not be read, so the plan was not checked.'
    await setTask($, (t): CrewTask => ({ ...t, phase: 'done', signoff: { status, missing: parsed?.missing ?? [], note } }))
    if (status === 'missing' && parsed) {
      const first = parsed.missing[0] as number
      $.ui.log(`Crew sign-off: plan step ${parsed.missing.join(', ')} looks missing ("${task.plan[first - 1] ?? ''}"). Type /crew back to send Claude back to it, or /crew leave to leave it. The Crew pane has both as buttons.`)
      await $.ui.open({ id: PANE, title: 'Crew' })
    } else if (status === 'ok') {
      $.ui.log('Crew sign-off: every step of the plan looks done.')
    }
    return out
  })

  // ---------- The pane ----------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($, e))
}
