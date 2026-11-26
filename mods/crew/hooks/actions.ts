import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CrewInfo, CrewRecipe, CrewStage, CrewTask } from '../types'
import { DEFAULT_RECIPE, EMPTY_TASK, nextEffort, nextModel } from './crew'

type Api = EngineInterface

// Change a tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const taskA = atom({ plugin: 'crew', key: 'task' } as const, EMPTY_TASK as CrewTask, { shape: 'task-1' })
const recipeA = atom({ plugin: 'crew', key: 'recipe' } as const, DEFAULT_RECIPE as CrewRecipe, { shape: 'recipe-1' })
const infoA = atom({ plugin: 'crew', key: 'info' } as const, { mode: 'shadow', repo: '' } as CrewInfo, { shape: 'info-1' })

function setTask($: EngineInterface, f: (t: CrewTask) => CrewTask): Promise<CrewTask> {
  return update($, taskA, f)
}

/** Keeps the recipe for this repo, so the next session starts from it. */
export async function saveRecipe($: Api, recipe: CrewRecipe): Promise<void> {
  const { repo } = await read($, infoA)
  try {
    await $.store.set(`recipe:${repo}`, recipe)
  } catch {
    // The recipe still holds for this session.
  }
}

export async function changeRecipe($: Api, f: (r: CrewRecipe) => CrewRecipe): Promise<CrewRecipe> {
  const next = await update($, recipeA, f)
  await saveRecipe($, next)
  return next
}

/** One press on a stage: the next model; Look up has no model of its own, so it steps its effort. */
export function cycleStage($: Api, stage: CrewStage): Promise<CrewRecipe> {
  return changeRecipe($, r => {
    const rule = r[stage]
    if (stage === 'look') return { ...r, look: { ...rule, effort: nextEffort(rule.effort) } }
    return { ...r, [stage]: { ...rule, model: nextModel(rule.model) } }
  })
}

/** Sign-off found a missing step: send Claude back to it. */
export async function sendBack($: Api): Promise<string> {
  const task = await read($, taskA)
  const n = task.signoff.missing[0]
  if (task.signoff.status !== 'missing' || n === undefined) return 'Nothing is missing, so there is nothing to send Claude back to.'
  await setTask($, (t): CrewTask => ({ ...t, phase: 'build', isEscalating: false, signoff: { ...t.signoff, status: 'sent' } }))
  await $.prompt.submit({
    text: `Your plan has a step that is not done yet: step ${n}, "${task.plan[n - 1] ?? ''}". Please do that step now, then tell me when it is done.`,
  })
  return `Sent Claude back to plan step ${n}.`
}

export async function leaveIt($: Api): Promise<string> {
  const task = await read($, taskA)
  if (task.signoff.status !== 'missing') return 'Nothing is waiting for an answer.'
  await setTask($, (t): CrewTask => ({ ...t, signoff: { ...t.signoff, status: 'left' } }))
  return `Left as it is. Plan step ${task.signoff.missing.join(', ')} stays open.`
}
