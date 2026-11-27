import type { CrewRecipe, CrewStage, CrewStep, CrewTask } from '../types'
import { colorOf, money, nameOf, normalise } from './crew'
import { svgDoc, svgLine, svgText, tint } from './kit'

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

/** The four stages in a row: done, live, or still to come, each with the model that takes it. */
export const trackSvg = (w: number, task: CrewTask, recipe: CrewRecipe): string => {
  const r = normalise(recipe)
  const live = liveIndex(task)
  const H = 66
  const colW = w / TRACK.length
  let out = ''
  TRACK.forEach((s, i) => {
    const cx = colW * i + colW / 2
    const c = colorOf(r[s].model)
    const state = i < live ? 'done' : i === live ? 'lit' : 'todo'
    if (i > 0) {
      out +=
        i <= live
          ? `<line x1="${(cx - colW + 15).toFixed(1)}" y1="16" x2="${(cx - 15).toFixed(1)}" y2="16" stroke="${tint(c, 0.6)}" stroke-width="2"/>`
          : svgLine(cx - colW + 15, 16, cx - 15, 16)
    }
    if (state === 'lit') out += `<circle cx="${cx.toFixed(1)}" cy="16" r="15" fill="${tint(c, 0.22)}"/>`
    if (state === 'todo') {
      out += `<circle cx="${cx.toFixed(1)}" cy="16" r="11" fill="none" class="l" stroke="#3a3e55" stroke-width="2"/>`
      out += svgText(cx, 20, String(i + 1), { ink: 'f', size: 11, weight: 600, anchor: 'middle' })
    } else {
      out += `<circle cx="${cx.toFixed(1)}" cy="16" r="11" fill="${state === 'lit' ? c : tint(c, 0.14)}" stroke="${c}" stroke-width="2"/>`
      out += svgText(cx, 20, state === 'done' ? '✓' : String(i + 1), { fill: state === 'lit' ? '#14121f' : c, size: 11, weight: 700, anchor: 'middle' })
    }
    out += svgText(cx, 44, TRACK_NAME[s] ?? s, { ink: state === 'todo' ? 'm' : 't', size: 13, weight: 600, anchor: 'middle' })
    const sub = s === 'check' ? `${nameOf(r.check.model)} helper` : nameOf(r[s].model)
    out += state === 'lit' ? svgText(cx, 60, sub, { fill: c, size: 11, anchor: 'middle' }) : svgText(cx, 60, sub, { ink: 'f', size: 11, anchor: 'middle' })
  })
  return svgDoc(w, H, out)
}

/** One bar per step: its colour is the model, its height the dollars. Dashed outline: the same step all on the best model. */
export const stripSvg = (w: number, steps: readonly CrewStep[], mode: 'shadow' | 'on', best: string): string => {
  const H = 78
  const shown = steps.slice(-60)
  const slot = w / Math.max(shown.length, 16)
  const bw = Math.max(2, Math.min(18, slot - 4))
  const priced = shown.flatMap(s => (s.crew !== null && s.base !== null ? [s.crew, s.base] : []))
  const peak = Math.max(0.0001, ...priced)
  const px = (v: number) => Math.max(3, (v / peak) * (H - 6))
  const bestColor = colorOf(best)
  let out =
    '<defs><pattern id="h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<rect width="2" height="5" fill="#000" opacity="0.45"/></pattern></defs>'
  shown.forEach((s, i) => {
    const x = slot * i + (slot - bw) / 2
    const c = colorOf(mode === 'on' ? (s.ran ?? s.picked) : s.picked)
    if (s.crew === null || s.base === null) {
      // No usage was reported for this step: a hollow mark, not a made-up height.
      out += `<rect x="${x.toFixed(1)}" y="${H - 6}" width="${bw.toFixed(1)}" height="5" fill="none" stroke="${c}" stroke-dasharray="2 2"/>`
      return
    }
    const h = px(s.crew)
    if (s.base > s.crew * 1.03) {
      out += `<rect x="${(x - 1).toFixed(1)}" y="${(H - px(s.base)).toFixed(1)}" width="${(bw + 2).toFixed(1)}" height="${px(s.base).toFixed(1)}" rx="2" fill="${tint(bestColor, 0.08)}" stroke="${tint(bestColor, 0.6)}" stroke-dasharray="3 2"/>`
    }
    out += `<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${c}"/>`
    if (s.hand > 0) {
      const hh = Math.min(h, px(s.hand))
      out += `<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="2" fill="url(#h)"/>`
    }
  })
  out += svgLine(0, H + 0.5, w, H + 0.5)
  // The key, under the bars.
  const models = [...new Set(shown.map(s => (mode === 'on' ? (s.ran ?? s.picked) : s.picked)))]
  let at = 0
  const Y = H + 18
  for (const m of models) {
    const word = nameOf(m)
    out += `<rect x="${at}" y="${Y - 9}" width="10" height="10" rx="2" fill="${colorOf(m)}"/>` + svgText(at + 15, Y, word, { size: 11 })
    at += 28 + word.length * 6
  }
  if (shown.some(s => s.hand > 0)) {
    out += `<rect x="${at}" y="${Y - 9}" width="10" height="10" rx="2" fill="#8d95ad"/><rect x="${at}" y="${Y - 9}" width="10" height="10" rx="2" fill="url(#h)"/>` + svgText(at + 15, Y, 'Hand-off', { size: 11 })
    at += 28 + 8 * 6
  }
  if (at + 150 < w) {
    out += `<rect x="${at + 0.5}" y="${Y - 8.5}" width="9" height="9" rx="2" fill="none" stroke="${tint(bestColor, 0.7)}" stroke-dasharray="3 2"/>` + svgText(at + 15, Y, `All on ${nameOf(best)}`, { size: 11 })
  }
  return svgDoc(w, H + 24, out)
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
