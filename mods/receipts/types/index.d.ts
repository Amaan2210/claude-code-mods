// What the mod keeps in `$.state`, and the shapes it keeps there.

export type StepKind = 'search' | 'read' | 'edit' | 'run' | 'helper'

/** One thing that really happened: a tool call that ran, in the order it finished. */
export type Step = {
  id: string
  kind: StepKind
  /** Set when a helper (a subagent) did it; absent when the main conversation did. */
  agent?: string
  /** Order numbers: `start` when the call began, `end` when it finished. */
  start: number
  end: number
  /** Edit and read: the file. */
  file?: string
  /** Search: what was searched for. Helper: what it was asked to do. */
  query?: string
  /** Run: the command, its exit code (absent when not known) and the end of its output. */
  cmd?: string
  exit?: number
  out?: string
  /** Set when the mod ran the command itself. */
  by?: 'Receipts'
  /** Edit: lines added and removed, and a few lines of the change ("+ text" or "- text"). */
  add?: number
  del?: number
  diff?: string[]
}

/** A checkable sentence found in Claude's answer. */
export type RawClaim = {
  kind: 'command' | 'edit' | 'count'
  /** The sentence, as Claude wrote it. */
  text: string
  /** command: build, test, lint or typecheck. edit: file names, comma apart. count: the number. */
  what: string
  /** command: a command the sentence names in backticks. */
  cmd?: string
}

export type ClaimStatus = 'ok' | 'none' | 'bad'

export type Claim = {
  id: string
  raw: RawClaim
  text: string
  status: ClaimStatus
  /** One plain sentence on why. */
  why: string
  /** Ids of the steps that prove it, or that show it fails. */
  proof: string[]
  /** An edit after which nothing was run (the gap a command claim falls into). */
  gap?: string
  /** The command the mod could run to settle it. */
  cmd?: string
  isSkipped?: true
}

export type HelperCheck = {
  agentId: string
  task: string
  /** The report, cut short. */
  text: string
  /** How many files the report says changed, when it says. */
  said?: number
  changed: string[]
  missing: string[]
  status: 'ok' | 'bad'
  /** The sentence added to the report, when it did not match. */
  note?: string
}

export type ReceiptsMeta = {
  /** Where the session runs. */
  cwd: string
  /** Order number at the start of the latest turn: what "this turn" means. */
  turnFrom: number
  /** True once a turn has ended and its answer was read. */
  hasAnswer: boolean
}

declare module 'claude-code' {
  interface PluginState {
    receipts: {
      steps: Shaped<Step[]>
      claims: Shaped<Claim[]>
      helpers: Shaped<HelperCheck[]>
      /** What each helper was asked to do, by agent id. */
      tasks: Shaped<Record<string, string>>
      meta: Shaped<ReceiptsMeta>
      picked: string
      isBusy: boolean
      /** True while the pane shows the built-in example. */
      isExample: boolean
    }
  }
}
