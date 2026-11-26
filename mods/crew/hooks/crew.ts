import type { CrewRecipe, CrewStage, CrewStep, CrewTask } from '../types'

// ---------- Models, prices, recipe ----------

export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku'
export const FAMILIES: Family[] = ['fable', 'opus', 'sonnet', 'haiku']
export const MODEL_IDS: Record<Family, string> = {
  fable: 'claude-fable-5-2',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}
export const NAMES: Record<Family, string> = {
  fable: 'Fable 5.2',
  opus: 'Opus 5.5',
  sonnet: 'Sonnet 5.5',
  haiku: 'Haiku 5.5',
}
export const COLORS: Record<Family, string> = {
  fable: '#b494ff',
  opus: '#ff9f6b',
  sonnet: '#62b4ff',
  haiku: '#7fd6a0',
}

/**
 * Dollars per million tokens: reading the chat fresh, reading it from the
 * cache, writing a reply. Anthropic's list prices as of November 2026. The
 * engine does not report prices, so every figure built from these is an
 * estimate. Change them here when prices change.
 */
export const RATES: Record<Family, { in: number; read: number; out: number }> = {
  fable: { in: 8, read: 0.2, out: 40 },
  opus: { in: 4, read: 0.2, out: 20 },
  sonnet: { in: 2, read: 0.1, out: 10 },
  // Haiku's cache-read price is assumed to be a tenth of its input price.
  haiku: { in: 0.1, read: 0.01, out: 0.5 },
}
// Haiku costs five times more once the chat it reads is longer than this.
const HAIKU_LONG = 100_000
const HAIKU_LONG_TIMES = 5
// Writing to the cache costs a quarter more than reading fresh (the 5-minute cache).
const CACHE_WRITE = 1.25

const ratesFor = (f: Family, promptTokens: number): { in: number; read: number; out: number } => {
  const r = RATES[f]
  if (f !== 'haiku' || promptTokens <= HAIKU_LONG) return r
  return { in: r.in * HAIKU_LONG_TIMES, read: r.read * HAIKU_LONG_TIMES, out: r.out * HAIKU_LONG_TIMES }
}

export const familyOf = (model: string | null | undefined): Family | null => {
  const m = (model ?? '').toLowerCase()
  return FAMILIES.find(f => m.includes(f)) ?? null
}
export const nameOf = (model: string | null | undefined): string => {
  const f = familyOf(model)
  return f ? NAMES[f] : (model ?? 'unknown model')
}
export const colorOf = (model: string | null | undefined): string => {
  const f = familyOf(model)
  return f ? COLORS[f] : '#8d95ad'
}

export const DEFAULT_RECIPE: CrewRecipe = {
  plan: { model: MODEL_IDS.fable, effort: 'high' },
  build: { model: MODEL_IDS.opus, effort: 'medium' },
  look: { model: MODEL_IDS.opus, effort: 'low' },
  check: { model: MODEL_IDS.haiku, effort: null },
  sign: { model: MODEL_IDS.fable, effort: 'high' },
}
export const STAGE_LABEL: Record<CrewStage, string> = {
  plan: 'Plan',
  build: 'Build',
  look: 'Look up',
  check: 'Check',
  sign: 'Sign-off',
}
export const STAGE_WHEN: Record<CrewStage, string> = {
  plan: 'until you approve the plan',
  build: 'edits, once the plan is approved',
  look: 'steps that only search and read',
  check: 'lint and build, run by a helper',
  sign: 'once a task, against the plan',
}
export const STAGES: CrewStage[] = ['plan', 'build', 'look', 'check', 'sign']

/** Look up stays on the Build model: switching inside a stage loses the prompt cache. */
export const normalise = (r: CrewRecipe): CrewRecipe => ({ ...r, look: { ...r.look, model: r.build.model } })

/** The next model after `model` in the list the person cycles through. */
export const nextModel = (model: string): string => {
  const i = FAMILIES.indexOf(familyOf(model) ?? 'fable')
  return MODEL_IDS[FAMILIES[(i + 1) % FAMILIES.length] as Family]
}
export const nextEffort = (e: string | null): 'low' | 'medium' | 'high' | null =>
  e === null ? null : e === 'low' ? 'medium' : e === 'medium' ? 'high' : 'low'

const rank = (m: string): number => {
  const f = familyOf(m)
  return f ? FAMILIES.indexOf(f) : 99
}
/** Is `a` a cheaper model than `b`? Unknown models are never called cheaper. */
export const isCheaper = (a: string, b: string): boolean => rank(a) < 99 && rank(b) < 99 && rank(a) > rank(b)

export const recipeLines = (r: CrewRecipe): string[] =>
  STAGES.map(s => {
    const rule = s === 'look' ? { ...r.look, model: r.build.model } : r[s]
    return `${STAGE_LABEL[s]}: ${nameOf(rule.model)}${rule.effort ? `, ${rule.effort} effort` : ', as a helper'} (${STAGE_WHEN[s]})`
  })

// ---------- Tasks ----------

export const newTask = (id: number, title: string, phase: CrewTask['phase'], usd0: number | null): CrewTask => ({
  id,
  phase,
  title: title.slice(0, 80),
  plan: [],
  files: [],
  steps: [],
  hands: 0,
  fails: {},
  isEscalating: false,
  helpers: [],
  lastMain: null,
  lastWasRead: false,
  signoff: { status: 'none', missing: [], note: '' },
  usd0,
  usdNow: usd0,
})

export const EMPTY_TASK: CrewTask = newTask(0, '', 'idle', null)

/** Plan steps: numbered, bulleted or checkbox lines of the plan text. Never more than 12. */
export const parsePlan = (text: string | null | undefined): string[] => {
  const out: string[] = []
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:\d+[.)]|[-*]\s*(?:\[[ xX]\])?)\s+(.+?)\s*$/.exec(raw)
    if (m?.[1]) out.push(m[1].replace(/\*\*/g, '').slice(0, 90))
    if (out.length >= 12) break
  }
  return out
}

// ---------- What a step did ----------

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const CHECK_RE =
  /\b(lint|eslint|tsc|typecheck|type-check|build|test|tests|jest|vitest|pytest|mypy|ruff|flake8|clippy|rustc)\b|\b(cargo|go|dotnet|gradle|mvn) (check|build|test|vet)\b|\bmake\b/i
const READ_CMD_RE =
  /^\s*(ls|cat|head|tail|grep|rg|find|pwd|git (status|log|diff|show|branch)|wc|file|stat|tree|dir|type|gci|gc|Get-ChildItem|Get-Content|Select-String|Get-Location|Test-Path)\b/i

export const isCheckCommand = (cmd: string): boolean => CHECK_RE.test(cmd)
export const checkKey = (cmd: string): string => cmd.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 80)

/** The tools that run a shell command: Bash everywhere, PowerShell on Windows. */
export const isShellTool = (name: string): boolean => name === 'Bash' || name === 'PowerShell'

export type StepKind = 'plan-exit' | 'check' | 'edit' | 'read' | 'other'
export type ToolUseLike = { name: string; input: unknown }

const commandOf = (u: ToolUseLike): string => {
  const c = (u.input as { command?: unknown } | null)?.command
  return typeof c === 'string' ? c : ''
}
const pathOf = (u: ToolUseLike): string => {
  const i = (u.input ?? {}) as { file_path?: unknown; notebook_path?: unknown; path?: unknown }
  const p = i.file_path ?? i.notebook_path ?? i.path
  return typeof p === 'string' ? p : ''
}

export const kindOfStep = (uses: readonly ToolUseLike[]): StepKind => {
  if (uses.some(u => u.name === 'ExitPlanMode')) return 'plan-exit'
  if (uses.some(u => isShellTool(u.name) && isCheckCommand(commandOf(u)))) return 'check'
  if (uses.some(u => EDIT_TOOLS.has(u.name))) return 'edit'
  if (uses.length > 0 && uses.every(u => READ_TOOLS.has(u.name) || (isShellTool(u.name) && READ_CMD_RE.test(commandOf(u))))) return 'read'
  return 'other'
}

const base = (p: string) => p.split(/[\\/]/).pop() ?? p
export const labelOfStep = (kind: StepKind, uses: readonly ToolUseLike[], stage: CrewStage): string => {
  if (stage === 'sign') return 'Compared the work with the plan'
  const first = uses[0]
  if (kind === 'plan-exit') return 'Showed the plan'
  if (kind === 'check') {
    const u = uses.find(x => isShellTool(x.name) && isCheckCommand(commandOf(x)))
    return `Ran ${u ? commandOf(u).slice(0, 40) : 'a check'}`
  }
  if (kind === 'edit') {
    const names = uses.filter(u => EDIT_TOOLS.has(u.name)).map(pathOf).filter(Boolean).map(base)
    return `Edited ${names[0] ?? 'a file'}`
  }
  if (kind === 'read' && first) return isShellTool(first.name) ? 'Looked around' : `${first.name === 'Read' ? 'Read' : 'Searched'} ${base(pathOf(first)) || 'the code'}`.trim()
  return stage === 'plan' ? 'Thought about the plan' : 'Replied'
}

export const filesOf = (uses: readonly ToolUseLike[]): string[] =>
  uses.filter(u => EDIT_TOOLS.has(u.name)).map(pathOf).filter(Boolean)

// ---------- Which model for the next step ----------

export type Pick = { stage: CrewStage; model: string; effort: 'low' | 'medium' | 'high' | null; isRescue: boolean }

/**
 * The model for the next main-loop step. It changes only at a hand-off:
 * a plan starting, a plan approved, a check failing twice, a sign-off.
 * Inside Build, a step after a read-only step asks for Look up's lower effort
 * on the same model, which is no hand-off.
 */
export const pickFor = (task: CrewTask, recipe: CrewRecipe): Pick => {
  const r = normalise(recipe)
  if (task.phase === 'sign') return { stage: 'sign', ...r.sign, isRescue: false }
  if (task.phase === 'plan') return { stage: 'plan', ...r.plan, isRescue: false }
  if (task.isEscalating) return { stage: 'plan', ...r.plan, isRescue: true }
  if (task.lastWasRead) return { stage: 'look', ...r.look, isRescue: false }
  return { stage: 'build', ...r.build, isRescue: false }
}

// ---------- Cost ----------

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model?: string
}
const M = 1e6

/** Dollars for one step's tokens on `model`. A hand-off step re-reads the whole chat as a fresh write. Null: no known price. */
export const costOf = (model: string | null, u: Usage, isHandoff: boolean): { total: number; hand: number } | null => {
  const f = familyOf(model)
  if (!f) return null
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const r = ratesFor(f, prompt)
  const out = (u.output_tokens * r.out) / M
  if (isHandoff) {
    const hand = (prompt * r.in * CACHE_WRITE) / M
    return { total: hand + out, hand }
  }
  const reading = (u.input_tokens * r.in + u.cache_read_input_tokens * r.read + u.cache_creation_input_tokens * r.in * CACHE_WRITE) / M
  return { total: reading + out, hand: 0 }
}

/** The same tokens, all on the best model with its cache kept warm. */
export const baseCostOf = (best: string, u: Usage, isHandoff: boolean): number | null => {
  const f = familyOf(best)
  if (!f) return null
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const r = ratesFor(f, prompt)
  const out = (u.output_tokens * r.out) / M
  // A hand-off only exists because the model changed: all on one model it would have been a cache read.
  if (isHandoff) return (prompt * r.read) / M + out
  return (u.input_tokens * r.in + u.cache_read_input_tokens * r.read + u.cache_creation_input_tokens * r.in * CACHE_WRITE) / M + out
}

export type Totals = { crew: number; base: number; hand: number; known: number; unknown: number }
export const totals = (steps: readonly CrewStep[]): Totals => {
  const t: Totals = { crew: 0, base: 0, hand: 0, known: 0, unknown: 0 }
  for (const s of steps) {
    if (s.crew === null || s.base === null) {
      t.unknown += 1
      continue
    }
    t.known += 1
    t.crew += s.crew
    t.base += s.base
    t.hand += s.hand
  }
  return t
}
export const money = (v: number): string => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`

// ---------- Sign-off ----------

export const signoffPrompt = (task: CrewTask): string =>
  [
    'You are checking finished work against its plan.',
    '',
    'The plan:',
    ...task.plan.map((p, i) => `${i + 1}. ${p}`),
    '',
    'Files changed:',
    ...(task.files.length ? [...new Set(task.files)].slice(0, 60).map(f => `- ${f}`) : ['(none)']),
    '',
    'Which plan steps have no sign of being done, judging only by the plan and the file list?',
    'Reply with JSON only, no other words: {"missing":[plan step numbers],"note":"one short plain sentence"}',
    'Use an empty list when every step looks done.',
  ].join('\n')

export type SignoffAnswer = { missing: number[]; note: string } | null
export const parseSignoff = (text: string, planLength: number): SignoffAnswer => {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { missing?: unknown; note?: unknown }
    if (!Array.isArray(j.missing)) return null
    const missing = [...new Set(j.missing.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= planLength))].sort((a, b) => a - b)
    return { missing, note: typeof j.note === 'string' ? j.note.slice(0, 160) : '' }
  } catch {
    return null
  }
}
