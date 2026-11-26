export type CrewStage = 'plan' | 'build' | 'look' | 'check' | 'sign'
export type CrewEffort = 'low' | 'medium' | 'high'
export type CrewRule = { model: string; effort: CrewEffort | null }
export type CrewRecipe = Record<CrewStage, CrewRule>

export type CrewStep = {
  n: number
  stage: CrewStage
  /** What the step did, in plain words. */
  label: string
  /** The model the crew picked (on) or would have picked (practice mode). */
  picked: string
  /** The model the engine says answered. Null when it reported none. */
  ran: string | null
  isHelper: boolean
  isHandoff: boolean
  isRescue: boolean
  /** Estimated dollars with the crew, or null when the engine gave no usage or the model has no known price. */
  crew: number | null
  /** The same step all on the best model, or null. */
  base: number | null
  /** The part of `crew` spent re-reading the chat after a hand-off. */
  hand: number
}

export type CrewTask = {
  id: number
  phase: 'idle' | 'plan' | 'build' | 'sign' | 'done'
  title: string
  plan: string[]
  files: string[]
  steps: CrewStep[]
  hands: number
  /** Failed runs in a row, by check command. */
  fails: Record<string, number>
  /** The best model takes the next main step. */
  isEscalating: boolean
  /** Check helpers started in this task (agent ids). */
  helpers: string[]
  lastMain: string | null
  lastWasRead: boolean
  signoff: {
    status: 'none' | 'would' | 'ok' | 'missing' | 'unknown' | 'sent' | 'left'
    missing: number[]
    note: string
  }
  /** Session cost (engine's estimate) when the task began, or null. */
  usd0: number | null
  usdNow: number | null
}

export type CrewInfo = { mode: 'shadow' | 'on'; repo: string }

declare module 'claude-code' {
  interface PluginState {
    crew: {
      task: Shaped<CrewTask>
      recipe: Shaped<CrewRecipe>
      info: Shaped<CrewInfo>
    }
  }
}
