import type { CrewRecipe, CrewStage, CrewStep, CrewTask } from '../types'
import { colorOf, money, nameOf, normalise } from './crew'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const TRACK: CrewStage[] = ['plan', 'build', 'check', 'sign']
const TRACK_NAME: Record<string, string> = { plan: 'Plan', build: 'Build', check: 'Check', sign: 'Sign-off' }

/** Which of the four stages is live: -1 before a task starts, 4 when all are done. */
export const liveIndex = (task: CrewTask): number => {
  if (task.phase === 'idle') return -1
  if (task.phase === 'plan') return 0
  if (task.phase === 'done') return task.signoff.status === 'ok' || task.signoff.status === 'left' || task.signoff.status === 'would' || task.signoff.status === 'none' ? 4 : 3
  if (task.phase === 'sign') return 3
  const last = task.steps.at(-1)
  return last?.stage === 'check' ? 2 : 1
}

export const trackSvg = (task: CrewTask, recipe: CrewRecipe): string => {
  const r = normalise(recipe)
  const live = liveIndex(task)
  const W = 400
  const H = 62
  const colW = W / TRACK.length
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, Segoe UI, sans-serif">`
  TRACK.forEach((s, i) => {
    const cx = colW * i + colW / 2
    const c = colorOf(r[s].model)
    const state = i < live ? 'done' : i === live ? 'lit' : 'todo'
    if (i > 0) out += `<line x1="${cx - colW}" y1="14" x2="${cx}" y2="14" stroke="${i <= live ? '#4b4670' : '#2a2c3a'}" stroke-width="2"/>`
    const halo = state === 'lit' ? `<circle cx="${cx}" cy="14" r="13" fill="${c}" opacity="0.22"/>` : ''
    const fill = state === 'lit' ? c : '#111219'
    const stroke = state === 'todo' ? '#343747' : c
    const text = state === 'done' ? '✓' : String(i + 1)
    out += `${halo}<circle cx="${cx}" cy="14" r="10" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
    out += `<text x="${cx}" y="18" text-anchor="middle" font-size="11" font-weight="600" fill="${state === 'lit' ? '#14121f' : state === 'done' ? c : '#70768a'}">${text}</text>`
    out += `<text x="${cx}" y="40" text-anchor="middle" font-size="12.5" font-weight="600" fill="${state === 'todo' ? '#9097ab' : '#e6e8f0'}">${TRACK_NAME[s]}</text>`
    const sub = s === 'check' ? `${nameOf(r.check.model)} helper` : nameOf(r[s].model)
    out += `<text x="${cx}" y="55" text-anchor="middle" font-size="11" fill="${state === 'lit' ? c : '#70768a'}">${esc(sub)}</text>`
  })
  return `${out}</svg>`
}

/** One bar per step: its colour is the model, its height the dollars. Dashed outline: the same step all on the best model. */
export const stripSvg = (steps: readonly CrewStep[], mode: 'shadow' | 'on'): string => {
  const W = 400
  const H = 64
  const shown = steps.slice(-60)
  const slot = W / Math.max(shown.length, 12)
  const bw = Math.max(2, Math.min(15, slot - 3))
  const priced = shown.flatMap(s => (s.crew !== null && s.base !== null ? [s.crew, s.base] : []))
  const peak = Math.max(0.0001, ...priced)
  const px = (v: number) => Math.max(3, (v / peak) * (H - 4))
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
  out += `<defs><pattern id="h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="#000" opacity="0.5"/></pattern></defs>`
  shown.forEach((s, i) => {
    const x = slot * i + (slot - bw) / 2
    const c = colorOf(mode === 'on' ? (s.ran ?? s.picked) : s.picked)
    if (s.crew === null || s.base === null) {
      // No usage was reported for this step: a hollow mark, not a made-up height.
      out += `<rect x="${x}" y="${H - 6}" width="${bw}" height="5" fill="none" stroke="${c}" stroke-dasharray="2 2"/>`
      return
    }
    const h = px(s.crew)
    if (s.base > s.crew * 1.03) out += `<rect x="${x - 1}" y="${H - px(s.base)}" width="${bw + 2}" height="${px(s.base)}" fill="none" stroke="#b494ff" stroke-opacity="0.55" stroke-dasharray="3 2"/>`
    out += `<rect x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="2" fill="${c}"/>`
    if (s.hand > 0) {
      const hh = Math.min(h, px(s.hand))
      out += `<rect x="${x}" y="${H - h}" width="${bw}" height="${hh}" rx="2" fill="url(#h)"/>`
    }
  })
  return `${out}</svg>`
}

export type Headline = { crew: string; base: string; diff: string; isMore: boolean; known: number; unknown: number }

export const headline = (t: { crew: number; base: number; known: number; unknown: number }): Headline | null => {
  if (t.known === 0) return null
  const saved = t.base - t.crew
  const pct = t.base > 0 ? Math.round((Math.abs(saved) / t.base) * 100) : 0
  return {
    crew: money(t.crew),
    base: money(t.base),
    diff: pct === 0 ? 'about the same' : `${pct}% ${saved < 0 ? 'more' : 'less'}`,
    isMore: saved < 0,
    known: t.known,
    unknown: t.unknown,
  }
}
