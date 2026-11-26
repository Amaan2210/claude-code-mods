// What the mod knows, as plain functions of the saved state. No `$` here.
import type { BlastRun, BlastSeen, BlastTarget } from '../types'

export type FileState = 'changed' | 'opened' | 'never'

export type FileRow = {
  file: string
  root: string
  /** Names it uses, each with its number of places. */
  names: { name: string; count: number }[]
  count: number
  state: FileState
}

export const norm = (path: string): string => path.replace(/\\/g, '/')
export const keyOf = (path: string): string => norm(path).toLowerCase()
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
export const shortName = (file: string): string => file.split('/').pop() ?? file

export const EMPTY_RUN: BlastRun = { targets: [], isEnded: false, choice: 'none', isFollowUp: false, problem: '' }

export function countPlaces(t: BlastTarget): number {
  return t.uses.length
}

/** Files that use the name, busiest first, with what Claude did with each. */
export function rowsFor(targets: readonly BlastTarget[], seen: BlastSeen): FileRow[] {
  const byKey = new Map<string, FileRow>()
  for (const t of targets) {
    for (const u of t.uses) {
      const key = `${t.root}/${u.file}`.toLowerCase()
      let row = byKey.get(key)
      if (!row) {
        row = { file: u.file, root: t.root, names: [], count: 0, state: seen[key] === 'changed' ? 'changed' : seen[key] === 'opened' ? 'opened' : 'never' }
        byKey.set(key, row)
      }
      const entry = row.names.find(n => n.name === t.name)
      if (entry) entry.count += 1
      else row.names.push({ name: t.name, count: 1 })
      row.count += 1
    }
  }

  return [...byKey.values()].sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
}

export function neverOpened(run: BlastRun, seen: BlastSeen): FileRow[] {
  return rowsFor(run.targets, seen).filter(r => r.state === 'never')
}

/** The one note Claude reads with the edit's result. */
export function noteFor(t: BlastTarget): string {
  const per = new Map<string, number>()
  for (const u of t.uses) per.set(u.file, (per.get(u.file) ?? 0) + 1)
  const files = [...per].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const shown = files.slice(0, 6).map(([f, n]) => `${f} ${n}`).join(', ')
  const rest = files.length - 6
  const more = rest > 0 ? `, and ${plural(rest, 'more file')}` : ''

  return `${t.name} is used in ${plural(t.uses.length, 'place')} in ${plural(files.length, 'file')}: ${shown}${more}.`
}

export function noteForAll(targets: readonly BlastTarget[]): string {
  return `Blast Radius: ${targets.map(noteFor).join(' ')} Check them if this change could affect them.`
}

/** The one sentence asked at the end of the turn. */
export function questionFor(run: BlastRun, never: readonly FileRow[]): string {
  const total = rowsFor(run.targets, {}).length
  const names = run.targets.map(t => t.name)
  const what = names.length === 1 ? names[0]! : `${names.length} names`
  const list = never.slice(0, 3).map(r => shortName(r.file)).join(', ')
  const rest = never.length - 3
  const tail = rest > 0 ? ` and ${plural(rest, 'more')}` : ''

  return `${what} changed. ${never.length} of the ${plural(total, 'file')} that use it were never opened: ${list}${tail}.`
}

export function checkPrompt(never: readonly FileRow[]): string {
  const files = never.slice(0, 20).map(r => `- ${r.file}`).join('\n')
  const rest = never.length - 20

  return (
    'Blast Radius: these files use code you changed this turn, and you never opened them. ' +
    'Open each one and check it still works with the change. Change it only if it needs it.\n' +
    files + (rest > 0 ? `\n- and ${plural(rest, 'more file')}` : '')
  )
}
