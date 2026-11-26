import type { PitStopFlow } from '../types'

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a reload.
export const FRESH_FLOW: PitStopFlow = {
  step: 0,
  isTurnOpen: false,
  gauge: { window: 0 },
  todos: [],
  edits: [],
  plan: [],
  seq: 0,
  cleans: 0,
}
