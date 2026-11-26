// The checking itself: plain functions, no `$`, so they can be tested alone.
import type { Claim, HelperCheck, RawClaim, Step } from '../types'

export const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path

const norm = (path: string): string => path.replace(/\\/g, '/').toLowerCase()

/** True when two spellings of a path name the same file (one may be shorter). */
export const sameFile = (a: string, b: string): boolean => {
  const x = norm(a)
  const y = norm(b)
  return x === y || x.endsWith('/' + y) || y.endsWith('/' + x)
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const EXT = 'tsx?|jsx?|mjs|cjs|json|md|py|go|rs|java|kt|rb|php|css|scss|html|ya?ml|toml|sh|sql|vue|svelte|cpp|cs|swift|c|h'
const FILE_RE = new RegExp(String.raw`[\w@~./\\-]*[\w-]\.(?:${EXT})(?![\w])`, 'g')

/** File names written in a text (src/a.ts, money.ts), once each. */
export const filesIn = (text: string): string[] => {
  const found = text.match(FILE_RE) ?? []
  return [...new Set(found.map(f => f.replace(/^[./\\]+(?=[\w@~])/, '')))]
}

const sentences = (text: string): string[] =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.replace(/^[\s>*#\-•]+/, '').replace(/\*\*/g, '').trim())
    .filter(s => s.length > 3)

// ---------- Finding claims ----------

const CHECKS = {
  build: /\b(build|builds|built|compile|compiles|compiled|compiling)\b/i,
  test: /\b(tests?|specs?|test suite)\b/i,
  lint: /\b(lint|linter|linting|eslint)\b/i,
  typecheck: /\b(type-?check(?:s|ing)?|tsc|types? check)\b/i,
}
const GOOD = /\b(pass(?:es|ed|ing)?|succe(?:ed|eds|eded)|successful(?:ly)?|green|clean(?:ly)?|compiles?|no errors|0 errors|without errors|no failures)\b/i
const NOT_A_CLAIM = /\b(not|n't|fail(?:s|ed|ing)?|can't|cannot|couldn't|didn't|should|would|will|could|if|ensure|make sure|please|want|need to|to see)\b/i
const CHANGED = /\b(updated|changed|edited|modified|fixed|replaced|migrated|renamed|added|removed|refactored|rewrote|created|wrote|now (?:call|use|read|show|return)s?)\b/i
const COUNT_RE = /\b(\d+)\s+(?:[\w-]+\s+){0,2}?(files?|pages?|components?|modules?|places|sites?|screens?|routes?|endpoints?|callers?|usages?)\b/i

export const checkKindOf = (text: string): 'build' | 'test' | 'lint' | 'typecheck' | undefined => {
  if (CHECKS.typecheck.test(text)) return 'typecheck'
  if (CHECKS.lint.test(text)) return 'lint'
  if (CHECKS.test.test(text)) return 'test'
  if (CHECKS.build.test(text)) return 'build'
  return undefined
}

const COMMAND_START = /^(npm|npx|pnpm|yarn|bun|deno|node|tsc|pytest|python3?|pip|cargo|go|make|mvn|gradle|dotnet|ruby|bundle|rspec|jest|vitest|eslint|ruff|mypy|claude)\b/

const namedCommand = (text: string): string | undefined => {
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) {
    const c = (m[1] ?? '').trim()
    if (COMMAND_START.test(c) && /\s|^tsc$|^pytest$/.test(c)) return c
  }
  return undefined
}

/** A cheap pass to see if an answer says anything worth reading for claims at all. */
export const looksCheckable = (answer: string): boolean =>
  answer.length >= 10 && (GOOD.test(answer) || CHANGED.test(answer) || COUNT_RE.test(answer))

/** The rule-based way to find claims; used when the model call fails. */
export const ruleClaims = (answer: string): RawClaim[] => {
  const out: RawClaim[] = []
  for (const text of sentences(answer)) {
    if (out.length >= 8) break
    if (NOT_A_CLAIM.test(text)) continue
    const kind = checkKindOf(text)
    if (kind && GOOD.test(text)) {
      out.push({ kind: 'command', text, what: kind, cmd: namedCommand(text) })
      continue
    }
    if (!CHANGED.test(text)) continue
    const count = COUNT_RE.exec(text)
    if (count) {
      out.push({ kind: 'count', text, what: String(Number(count[1])) })
      continue
    }
    const files = filesIn(text)
    if (files.length) out.push({ kind: 'edit', text, what: files.join(',') })
  }
  return out
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Reads the small model's reply: one claim to a line, `CMD | build | sentence`,
 * `EDIT | a.ts, b.ts | sentence`, `COUNT | 6 | sentence`. Anything else is dropped,
 * and so is a sentence that is not in the answer.
 */
export const parseModelClaims = (reply: string, answer: string): RawClaim[] | undefined => {
  const lines = reply.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 1 && /^none$/i.test(lines[0] ?? '')) return []
  const seen = squash(answer)
  const out: RawClaim[] = []
  for (const line of lines) {
    const m = /^(CMD|EDIT|COUNT)\s*\|\s*([^|]+?)\s*\|\s*(.+)$/i.exec(line)
    if (!m) continue
    const tag = (m[1] ?? '').toUpperCase()
    const what = (m[2] ?? '').trim()
    const text = (m[3] ?? '').trim()
    const head = squash(text).slice(0, 24)
    if (head.length < 6 || !seen.includes(head)) continue
    if (tag === 'CMD') {
      const kind = ['build', 'test', 'lint', 'typecheck'].includes(what.toLowerCase())
        ? what.toLowerCase()
        : checkKindOf(text)
      if (kind) out.push({ kind: 'command', text, what: kind, cmd: namedCommand(text) })
    } else if (tag === 'EDIT') {
      const files = filesIn(what)
      if (files.length) out.push({ kind: 'edit', text, what: files.join(',') })
    } else if (/^\d{1,4}$/.test(what)) {
      out.push({ kind: 'count', text, what: String(Number(what)) })
    }
    if (out.length >= 8) break
  }
  return out.length || lines.length === 0 ? out : undefined
}

export const MODEL_PROMPT = (answer: string): string =>
  [
    'Below is the final answer of a coding assistant. List the sentences in it that claim something a log of its actions could prove or disprove.',
    'Only three kinds count. One line each, in exactly this format, nothing else:',
    'CMD | build, test, lint or typecheck | the sentence  (it says a check passes or works)',
    'EDIT | file names, comma apart | the sentence  (it says it changed, added or fixed something in named files)',
    'COUNT | the number | the sentence  (it says N files, pages or places were changed)',
    'Copy each sentence exactly as written. Skip plans, advice, questions and claims that something failed.',
    'If there are none, answer: NONE',
    '',
    '<answer>',
    answer.slice(0, 6000),
    '</answer>',
  ].join('\n')

// ---------- Judging claims against the record ----------

const KIND_RUN: Record<string, RegExp> = {
  build: /\b(build|compile|tsc|webpack|vite|rollup|esbuild|make|gradle|mvn|cargo build|go build)\b/i,
  test: /\b(test|tests|jest|vitest|pytest|mocha|rspec|phpunit)\b/i,
  lint: /\b(lint|eslint|ruff|flake8|biome)\b/i,
  typecheck: /\b(tsc|typecheck|type-check|mypy|pyright)\b/i,
}

const words = (kind: string): string =>
  kind === 'typecheck' ? 'type check' : kind

const edits = (steps: Step[]): Step[] => steps.filter(s => s.kind === 'edit')
const runs = (steps: Step[]): Step[] => steps.filter(s => s.kind === 'run')

export const lastEdit = (steps: Step[]): Step | undefined =>
  edits(steps).reduce<Step | undefined>((a, s) => (!a || s.end > a.end ? s : a), undefined)

/** Distinct files changed since `from` (an order number). */
export const filesChanged = (steps: Step[], from = 0): string[] => {
  const out: string[] = []
  for (const s of edits(steps)) {
    if (s.end < from || !s.file) continue
    const file = s.file
    if (!out.some(o => sameFile(o, file))) out.push(file)
  }
  return out
}

export const checkClaim = (raw: RawClaim, steps: Step[], turnFrom: number, id: string): Claim => {
  const base = { id, raw, text: raw.text }
  if (raw.kind === 'command') return checkCommand(raw, steps, base)
  if (raw.kind === 'edit') {
    const wanted = raw.what.split(',').map(s => s.trim()).filter(Boolean)
    const found: string[] = []
    const absent: string[] = []
    for (const file of wanted) {
      const hit = edits(steps).filter(s => s.file && sameFile(s.file, file))
      if (hit.length) found.push(...hit.slice(-1).map(h => h.id))
      else absent.push(basename(file))
    }
    if (!absent.length) {
      return { ...base, status: 'ok', proof: found, why: `${wanted.map(basename).join(', ')} ${wanted.length === 1 ? 'was' : 'were'} edited in this session.` }
    }
    return {
      ...base,
      status: 'none',
      proof: found,
      why: `No edit to ${absent.join(', ')} is on record.`,
    }
  }
  const n = Number(raw.what)
  const changed = filesChanged(steps, turnFrom)
  const proof = edits(steps).filter(s => s.end >= turnFrom).map(s => s.id)
  if (changed.length >= n) {
    return { ...base, status: 'ok', proof, why: `${plural(changed.length, 'file')} changed in this turn.` }
  }
  return {
    ...base,
    status: 'bad',
    proof,
    why: `Said ${n}. ${plural(changed.length, 'file')} changed in this turn.`,
  }
}

const checkCommand = (raw: RawClaim, steps: Step[], base: { id: string; raw: RawClaim; text: string }): Claim => {
  const kind = raw.what
  const re = KIND_RUN[kind] ?? KIND_RUN.build!
  const matching = runs(steps).filter(s => {
    const cmd = s.cmd ?? ''
    return raw.cmd ? cmd.includes(raw.cmd) : re.test(cmd)
  })
  const last = matching.reduce<Step | undefined>((a, s) => (!a || s.end > a.end ? s : a), undefined)
  const edit = lastEdit(steps)
  const label = raw.cmd ?? words(kind)
  if (!last) {
    return {
      ...base,
      status: 'none',
      proof: [],
      cmd: raw.cmd,
      why: raw.cmd ? `\`${raw.cmd}\` did not run in this session.` : `No ${label} ran in this session.`,
    }
  }
  const cmd = last.cmd
  if (last.exit === undefined) {
    return { ...base, status: 'none', proof: [last.id], cmd, why: `\`${cmd}\` started, but its result is not known.` }
  }
  if (edit && last.start < edit.end) {
    return {
      ...base,
      status: 'none',
      proof: [last.id, edit.id],
      gap: edit.id,
      cmd,
      why: `The last ${label} ran before the last edit, to ${basename(edit.file ?? 'a file')}. Nothing has checked the code as it is now.`,
    }
  }
  if (last.exit === 0) {
    return { ...base, status: 'ok', proof: [last.id], cmd, why: `\`${cmd}\` ran${edit ? ' after the last edit' : ''} and exited with 0.` }
  }
  return { ...base, status: 'bad', proof: [last.id], cmd, why: `\`${cmd}\` ran${edit ? ' after the last edit' : ''} and exited with ${last.exit}.` }
}

/** The one line shown under the answer, or undefined when every claim is proven. */
export const lineFor = (claims: Claim[]): string | undefined => {
  const open = claims.filter(c => c.status !== 'ok' && !c.isSkipped)
  if (!open.length) return undefined
  const lines = open.slice(0, 2).map(c => `“${clip(c.text, 90)}” ${c.status === 'bad' ? 'Does not match: ' : 'No proof: '}${c.why}`)
  const more = open.length > 2 ? ` (${open.length - 2} more: see /receipts)` : ''
  const ok = claims.filter(c => c.status === 'ok').length
  return `Receipts, ${ok} of ${plural(claims.length, 'claim')} proven.\n${lines.join('\n')}${more}`
}

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export const statusFor = (claims: Claim[]): string => {
  const ok = claims.filter(c => c.status === 'ok').length
  return `${ok} of ${plural(claims.length, 'claim')} proven`
}

// ---------- Judging a helper's report ----------

const nameList = (files: string[]): string => {
  const names = files.map(basename)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/**
 * Compares what a helper's report says changed with what it really changed.
 * `onDisk` is the list of files the version control diff shows, when it is known.
 */
export const checkHelper = (
  agentId: string,
  report: string,
  task: string,
  steps: Step[],
  onDisk?: { root: string; files: string[] },
): HelperCheck => {
  const mine = steps.filter(s => s.agent === agentId)
  let changed = filesChanged(mine)
  if (onDisk) {
    // Only files under the folder the diff covers can be checked against it.
    const root = norm(onDisk.root).replace(/\/$/, '') + '/'
    changed = changed.filter(
      f => !norm(f).startsWith(root) || onDisk.files.some(d => sameFile(f, `${onDisk.root}/${d}`)),
    )
  }
  let said: number | undefined
  for (const sentence of sentences(report)) {
    if (!CHANGED.test(sentence) || NOT_A_CLAIM.test(sentence)) continue
    const m = COUNT_RE.exec(sentence)
    if (m) {
      said = Number(m[1])
      break
    }
  }
  const named = filesIn(report)
  const candidates = named.length ? named : said !== undefined ? filesIn(task) : []
  const missing = candidates.filter(f => !changed.some(c => sameFile(c, f)))
  const countOff = said !== undefined && said !== changed.length
  const namedOff = said === undefined && missing.length > 0
  const base = { agentId, task, text: clip(report.replace(/\s+/g, ' ').trim(), 140), said, changed: changed.map(basename), missing: missing.map(basename) }
  if (!countOff && !namedOff) return { ...base, status: 'ok' }
  const note = countOff
    ? `The report says ${plural(said ?? 0, 'file')} changed. ${changed.length} did${missing.length ? `: ${nameList(missing)} ${missing.length === 1 ? 'was' : 'were'} not touched` : ''}.`
    : `The report says ${nameList(missing)} changed. ${missing.length === 1 ? 'It was' : 'They were'} not touched.`
  return { ...base, status: 'bad', note }
}
