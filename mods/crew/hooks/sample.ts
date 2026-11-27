// A made-up task, shown when the person asks to see an example. Nothing here is from their work.
import type { CrewStage, CrewStep, CrewTask } from '../types'
import { DEFAULT_RECIPE, MODEL_IDS } from './crew'

const FABLE = MODEL_IDS.fable
const OPUS = MODEL_IDS.opus
const HAIKU = MODEL_IDS.haiku

type Row = [stage: CrewStage, label: string, model: string, crew: number, base: number, hand?: number]

const rows: Row[] = [
  ['plan', 'Read checkout.js', FABLE, 0.22, 0.22],
  ['plan', 'Searched "giftNote"', FABLE, 0.31, 0.31],
  ['plan', 'Read order.js', FABLE, 0.27, 0.27],
  ['plan', 'Wrote the plan', FABLE, 0.3, 0.3],
  ['build', 'Edited address.js', OPUS, 0.39, 0.44, 0.17],
  ['build', 'Read summary.js', OPUS, 0.06, 0.12],
  ['look', 'Searched "giftNote"', OPUS, 0.03, 0.06],
  ['build', 'Edited summary.js', OPUS, 0.03, 0.07],
  ['check', 'Ran npm run lint', HAIKU, 0.01, 0.22],
  ['check', 'Ran npm run build (failed)', HAIKU, 0.03, 0.55],
  ['build', 'Edited order-types.js', OPUS, 0.03, 0.08],
  ['check', 'Ran npm run build (failed)', HAIKU, 0.03, 0.5],
  ['build', 'Edited schema/order.yaml', FABLE, 1.03, 1.03, 0.44],
  ['check', 'Ran npm run build', HAIKU, 0.03, 0.52],
  ['build', 'Said the task was done', OPUS, 0.07, 0.09, 0.03],
  ['sign', 'Compared the work with the plan', FABLE, 0.18, 0.18, 0.02],
]

const steps: CrewStep[] = rows.map(([stage, label, model, crew, base, hand], i) => ({
  n: i + 1,
  stage,
  label,
  picked: model,
  ran: model,
  isHelper: stage === 'check',
  isHandoff: (hand ?? 0) > 0,
  isRescue: i === 12,
  crew,
  base,
  hand: hand ?? 0,
}))

export const SAMPLE_TASK: CrewTask = {
  id: 1,
  phase: 'done',
  title: 'Gift note at checkout',
  plan: ['add the field', 'show it in the summary', 'save it with the order'],
  files: ['src/address.js', 'src/summary.js', 'src/order-types.js', 'schema/order.yaml'],
  steps,
  hands: 4,
  fails: {},
  isEscalating: false,
  helpers: [],
  lastMain: FABLE,
  lastWasRead: false,
  signoff: { status: 'missing', missing: [3], note: 'Nothing saves the gift note with the order yet.' },
  usd0: null,
  usdNow: null,
}

export const SAMPLE_RECIPE = DEFAULT_RECIPE
