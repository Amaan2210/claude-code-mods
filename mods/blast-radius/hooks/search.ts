// Finds where names are used: one `git grep` through `$.process.run`.
// It matches whole words only, so it cannot tell two functions with the same
// name apart, and it does not follow imports or renames.
import type { EngineInterface } from 'claude-code'

import type { BlastTarget, BlastUse } from '../types'
import { declOfLine } from './names'
import { norm } from './model'

export const LIMITS = {
  /** Longest a search may run before it is given up. */
  timeoutMs: 1500,
  /** Names looked up for one edit. */
  maxNames: 4,
  /** A name used in more places than this is too common to mean anything. */
  maxUses: 200,
  /** Lines of git output read. */
  maxLines: 5000,
  /** Longest line of code kept. */
  textLength: 140,
}

const SKIP_FOLDERS = ['node_modules', 'vendor', 'third_party', 'dist', 'build', 'out', 'coverage', '.next', '.venv', '__pycache__', 'target']
const SKIP_FILES = ['*.min.*', '*.map', '*.lock', 'package-lock.json', '*.md', '*.mdx', '*.txt', '*.svg', '*.snap', '*.json', '*.csv']
export const EXCLUDES: string[] = [
  ...SKIP_FOLDERS.map(f => `:(top,exclude,glob)**/${f}/**`),
  ...SKIP_FILES.map(f => `:(top,exclude,glob)**/${f}`),
]

const roots = new Map<string, string>()

export function dirOf(path: string): string {
  const p = norm(path)
  const i = p.lastIndexOf('/')

  return i > 0 ? p.slice(0, i) : i === 0 ? '/' : '.'
}

export function relativeTo(root: string, path: string): string | undefined {
  const r = norm(root).replace(/\/+$/, '')
  const p = norm(path)

  return p.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? p.slice(r.length + 1) : undefined
}

async function rootOf($: EngineInterface, dir: string): Promise<string | undefined> {
  const known = roots.get(dir)
  if (known) return known
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs: LIMITS.timeoutMs })
  const root = norm(r.stdout.trim())
  if (r.exitCode !== 0 || !root) return undefined
  if (roots.size > 50) roots.clear()
  roots.set(dir, root)

  return root
}

const escape = (s: string) => s.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&')
const isComment = (text: string) => /^(\/\/|#|\*|\/\*|--|<!--)/.test(text.trim())

export type Found = { targets: BlastTarget[]; problem: string }

/**
 * Where each of `names` is used in the repo that holds `filePath`. Leaves out
 * the edited file itself, each name's own definition lines and comment lines.
 * Never throws: a failed search answers `{ targets: [], problem }`.
 */
export async function findUses($: EngineInterface, filePath: string, names: readonly string[]): Promise<Found> {
  try {
    const list = names.slice(0, LIMITS.maxNames)
    if (list.length === 0) return { targets: [], problem: '' }
    const root = await rootOf($, dirOf(filePath))
    if (!root) return { targets: [], problem: 'This folder is not in a git repository, so uses were not looked up.' }
    const edited = relativeTo(root, filePath)?.toLowerCase()
    const argv = [
      'git', '-c', 'core.quotePath=false', 'grep', '-n', '-I', '-w', '-F', '--no-color', '--untracked',
      ...list.flatMap(n => ['-e', n]), '--', ':/', ...EXCLUDES,
    ]
    const r = await $.process.run(argv, { cwd: root, timeoutMs: LIMITS.timeoutMs })
    if (r.exitCode > 1) return { targets: [], problem: 'The search for uses did not finish.' }
    const lines = r.stdout.split('\n', LIMITS.maxLines)
    const targets: BlastTarget[] = []
    for (const name of list) {
      const word = new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`)
      const uses: BlastUse[] = []
      for (const line of lines) {
        const m = /^(.*?):(\d+):(.*)$/.exec(line)
        if (!m) continue
        const file = m[1]!
        const text = m[3]!
        if (file.toLowerCase() === edited || !word.test(text) || isComment(text)) continue
        if (declOfLine(text)?.name === name) continue
        uses.push({ file, line: Number(m[2]), text: text.trim().slice(0, LIMITS.textLength) })
      }
      if (uses.length === 0 || uses.length > LIMITS.maxUses) continue
      targets.push({ name, defFile: edited ? (relativeTo(root, filePath) ?? filePath) : filePath, root, uses })
    }

    return { targets, problem: '' }
  } catch {
    return { targets: [], problem: 'The search for uses did not finish.' }
  }
}
