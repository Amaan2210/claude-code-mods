export type BlastUse = { file: string; line: number; text: string }

export type BlastTarget = {
  /** The function or exported name that an edit changed. */
  name: string
  /** The file it is defined in, relative to the repo root. */
  defFile: string
  /** The repo root, forward slashes. */
  root: string
  uses: BlastUse[]
}

export type BlastRun = {
  targets: BlastTarget[]
  /** True once the turn that made the edits has ended. */
  isEnded: boolean
  /** The end-of-turn question: not asked yet, or what the person chose. */
  choice: 'none' | 'check' | 'skip'
  /** True while the follow-up turn the person asked for is running. */
  isFollowUp: boolean
  /** Why the last lookup found nothing it could trust, or ''. */
  problem: string
}

/** Lower-cased full path (forward slashes) to what Claude did with it. */
export type BlastSeen = Record<string, 'opened' | 'changed'>

export type BlastView = { name: string | null; file: string | null }

declare module 'claude-code' {
  interface PluginState {
    'blast-radius': {
      run: Shaped<BlastRun>
      seen: Shaped<BlastSeen>
      view: Shaped<BlastView>
    }
  }
}
