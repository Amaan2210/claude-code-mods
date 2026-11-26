import type { PitStopFlow, PitStopItem, PitStopTodo } from '../types'

// Rules of thumb, in steps (one step is one tool call). Each is shown to the person as a reason.
export const FILE_IDLE = 5 // a file not touched for more than this many steps goes
export const EDIT_RECENT = 8 // a file edited this recently stays
export const CMD_IDLE = 1 // command output not used on the last step goes
export const NOTE_TOKENS = 60 // what one kept one-line note is guessed to cost
export const BURST_STEPS = 10 // "several edits in the last few steps"
export const BUSY_FILES = 3 // this many different files changed in those steps is a change under way
export const MAX_HOLD_STEPS = 40 // a hold never outlives this many steps

/** Sizes are guesses: about 4 characters to a token. */
export const estimate = (text: string): number => Math.max(1, Math.ceil(text.length / 4))

export const isLocked = (item: Pick<PitStopItem, 'kind'>): boolean =>
  item.kind === 'request' || item.kind === 'notes' || item.kind === 'todo'

export type Entry = {
  item: PitStopItem
  keeps: boolean
  why: string
  isMoved: boolean
  isLocked: boolean
}

export type Plan = {
  entries: Entry[]
  stays: Entry[]
  goes: Entry[]
  /** Tokens in the memory that no listed item accounts for (tools, rules, the rest). */
  otherTokens: number
  listedStays: number
  goTokens: number
  /** What a clean-up is guessed to free: what goes, less one short note per item. */
  freeTokens: number
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

export function classify(
  items: readonly PitStopItem[],
  movedIds: readonly string[],
  flow: PitStopFlow,
): Plan {
  const change = changeState(flow)
  const planned = new Set(flow.plan.map(baseName))
  const newestByKey = new Map<string, string>()
  for (const it of items) if (it.key) newestByKey.set(it.key, it.id)

  const entries = items.map((item): Entry => {
    const locked = isLocked(item)
    const idle = flow.step - item.lastStep
    let keeps = true
    let why: string
    if (item.kind === 'request') why = 'your requests always stay'
    else if (item.kind === 'notes') why = "Claude's own notes stay"
    else if (item.kind === 'todo') why = 'open items always stay'
    else if (idle <= 0) why = 'in use right now'
    else if (item.key && newestByKey.get(item.key) !== item.id) {
      keeps = false
      why = 'a newer run replaced it'
    } else if (item.editedStep !== undefined && flow.step - item.editedStep <= EDIT_RECENT) {
      why = `edited ${count(flow.step - item.editedStep, 'step')} ago`
    } else if (item.kind === 'file' && change.isOpen && item.path && planned.has(baseName(item.path))) {
      why = 'named in the change Claude is making'
    } else if (item.kind === 'cmd') {
      keeps = idle <= CMD_IDLE
      why = keeps ? 'used on the last step' : `old output, not used for ${count(idle, 'step')}`
    } else {
      keeps = idle <= FILE_IDLE
      why = keeps ? `opened ${count(idle, 'step')} ago` : `not touched for ${count(idle, 'step')}`
    }
    const isMoved = !locked && movedIds.includes(item.id)
    if (isMoved) {
      keeps = !keeps
      why = 'moved by you'
    }
    return { item, keeps, why, isMoved, isLocked: locked }
  })

  const stays = entries.filter(x => x.keeps)
  const goes = entries.filter(x => !x.keeps)
  const listed = entries.reduce((s, x) => s + x.item.tokens, 0)
  const otherTokens = flow.gauge.tokens === undefined ? 0 : Math.max(0, flow.gauge.tokens - listed)
  const goTokens = goes.reduce((s, x) => s + x.item.tokens, 0)
  const freeTokens = goes.reduce((s, x) => s + Math.max(0, x.item.tokens - NOTE_TOKENS), 0)
  return {
    entries,
    stays,
    goes,
    otherTokens,
    listedStays: stays.reduce((s, x) => s + x.item.tokens, 0),
    goTokens,
    freeTokens,
  }
}

export type Change = {
  isOpen: boolean
  done: number
  total: number
  /** Which signal says so. */
  signal: 'todos' | 'edits' | 'busy' | 'none'
  why: string
}

const CLOSED: Change = { isOpen: false, done: 0, total: 0, signal: 'none', why: '' }

/**
 * Is Claude in the middle of a multi-file change? Three checkable signals:
 *  1. the latest todo list has items not completed (an unfinished plan);
 *  2. two or more different files were edited in the last BURST_STEPS steps and
 *     the plan (files named in the request, the todo list and Claude's replies)
 *     names more files than were edited;
 *  3. nothing names any file, and BUSY_FILES or more different files were edited in the last
 *     BURST_STEPS steps.
 */
export function changeState(flow: PitStopFlow): Change {
  const open = flow.todos.filter((t: PitStopTodo) => t.status !== 'completed')
  if (flow.todos.length > 0 && open.length > 0) {
    const done = flow.todos.length - open.length
    return {
      isOpen: true,
      done,
      total: flow.todos.length,
      signal: 'todos',
      why: `${done} of ${count(flow.todos.length, 'task')} in its to-do list done`,
    }
  }
  // Files edited in the last few steps say a change is under way; every file edited since the
  // request counts as done, so a file finished long ago is not waited for again.
  const recent = new Set(flow.edits.filter(x => flow.step - x.step < BURST_STEPS).map(x => baseName(x.path)))
  if (recent.size >= 2) {
    const edited = new Set(flow.edits.map(x => baseName(x.path)))
    const left = [...new Set(flow.plan.map(baseName))].filter(p => !edited.has(p))
    if (left.length > 0) {
      return {
        isOpen: true,
        done: edited.size,
        total: edited.size + left.length,
        signal: 'edits',
        why: `${edited.size} of ${edited.size + left.length} files it named are changed`,
      }
    }
  }
  // No list and no names to go by: three or more different files changed in the last few steps
  // still says Claude is going through files one after another.
  if (flow.plan.length === 0 && recent.size >= BUSY_FILES) {
    return {
      isOpen: true,
      done: recent.size,
      total: recent.size,
      signal: 'busy',
      why: `it changed ${recent.size} files in its last ${BURST_STEPS} steps`,
    }
  }
  return CLOSED
}

// Only endings that are files people edit: `console.log` and `e.g` are not file names.
const FILE_ENDINGS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs', 'c', 'h', 'cpp',
  'hpp', 'swift', 'css', 'scss', 'html', 'vue', 'svelte', 'json', 'yaml', 'yml', 'toml', 'md', 'sql', 'sh',
])

/** File names in a piece of text: `a/b.ts`, `README.md`. */
export function namedFiles(text: string): string[] {
  const found = text.match(/[\w@.\\/-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/g) ?? []
  const isFile = (n: string) => n.length > 2 && !/^\d/.test(n) && FILE_ENDINGS.has((n.split('.').pop() ?? '').toLowerCase())
  return [...new Set(found.map(baseName).filter(isFile))].slice(0, 60)
}

/** The fullness at which to ask again after "not yet". */
export function askAgainAt(current: number, hardLimit: number): number {
  return current < 90 ? 90 : Math.min(hardLimit - 1, current + 5)
}

export const tokensFmt = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`

export const percentOf = (tokens: number, window: number): number =>
  window > 0 ? Math.round((tokens / window) * 100) : 0

export const STEER_MARK = 'Pit Stop:'

/** What to tell the summary so what must stay does. */
export function keepInstructions(plan: Plan, flow: PitStopFlow): string {
  const asked = plan.stays.filter(x => x.item.kind === 'request').map(x => x.item.label)
  const open = flow.todos.filter(t => t.status !== 'completed').map(t => t.text)
  const staying = plan.stays
    .filter(x => x.item.kind === 'file' || x.item.kind === 'cmd')
    .map(x => x.item.label)
  const going = plan.goes.map(x => x.item.label)
  const lines = [
    `${STEER_MARK} keep every request the person made, every decision, and every open item exactly.`,
    asked.length ? `Requests to keep: ${asked.slice(-12).join(' | ')}.` : '',
    open.length ? `Open items to keep: ${open.slice(0, 12).join(' | ')}.` : '',
    staying.length ? `Still in use, keep what matters: ${staying.slice(0, 12).join(', ')}.` : '',
    going.length
      ? `Not needed in full, one short line of what was learned from each is enough: ${going.slice(0, 20).join(', ')}.`
      : '',
  ]
  return lines.filter(Boolean).join('\n').slice(0, 2400)
}
