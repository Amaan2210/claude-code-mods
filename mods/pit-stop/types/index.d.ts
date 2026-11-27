export type PitStopKind = 'file' | 'cmd' | 'request' | 'notes' | 'todo'

/** One thing in Claude's memory. Sizes are estimates (about 4 characters a token). */
export type PitStopItem = {
  id: string
  kind: PitStopKind
  label: string
  tokens: number
  addedStep: number
  lastStep: number
  editedStep?: number
  path?: string
  /** Same value on two items: the later one replaces the earlier. */
  key?: string
}

export type PitStopTodo = { text: string; status: string }

export type PitStopPoint = { step: number; percent: number }

export type PitStopLast = {
  step: number
  tokensBefore?: number
  tokensAfter?: number
  estimatedFreed: number
  dropped: number
}

export type PitStopFlow = {
  step: number
  isTurnOpen: boolean
  gauge: { percent?: number; tokens?: number; window: number }
  todos: PitStopTodo[]
  edits: { path: string; step: number }[]
  plan: string[]
  held?: { step: number; percent: number }
  /** Fullness at which the next offer is made; absent means the setting. */
  askAt?: number
  seq: number
  /** How many clean-ups Pit Stop has recorded. */
  cleans: number
  last?: PitStopLast
}

export type PitStopOffer = {
  seq: number
  kind: 'offer' | 'held' | 'done'
  status: 'asking' | 'later' | 'done'
  percent: number
  freePercent: number
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'pit-stop': {
      items: Shaped<PitStopItem[]>
      moved: Shaped<string[]>
      flow: Shaped<PitStopFlow>
      history: Shaped<PitStopPoint[]>
      offers: Shaped<PitStopOffer[]>
      /** True while the pane shows the built-in example. */
      isExample: boolean
    }
  }
}
