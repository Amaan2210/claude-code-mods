// The picture of one changed name: it sits in the middle and every file that
// uses it is a dot around it, coloured by what Claude did with the file.
import { esc, fit, svgDoc, svgText, tint } from './kit'
import type { FileRow, FileState } from './model'
import { plural, shortName } from './model'

export const COLORS = {
  changed: '#6fd696',
  opened: '#6fb7ff',
  never: '#ff7a59',
  name: '#ffe7a8',
  /** The name in running text: readable on a dark and on a light pane. */
  nameText: '#e2a93b',
  grey: '#8d8d99',
} as const

export const MAX_DOTS = 14

// On a light pane the names in the map get darker inks, so they stay readable.
const LIGHT =
  '<style>@media (prefers-color-scheme: light){.bn{fill:#8a5a00}.b-changed{fill:#1c7c4a}.b-opened{fill:#1f6fc2}.b-never{fill:#c2410c}}</style>'
const MONO = `font-family="'Cascadia Mono', Consolas, monospace"`

const fileLabel = (x: number, y: number, text: string, state: FileState, anchor: 'start' | 'middle' | 'end'): string =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="11.5" font-weight="600" ${MONO} text-anchor="${anchor}" class="b-${state}" fill="${COLORS[state]}">${esc(text)}</text>`

export function countStates(rows: readonly FileRow[]): Record<FileState, number> {
  const out: Record<FileState, number> = { changed: 0, opened: 0, never: 0 }
  for (const r of rows) out[r.state] += 1

  return out
}

/** Words for a file's state: while Claude works, and once the turn is over. */
export function stateWords(state: FileState, isEnded: boolean): string {
  return state === 'changed' ? 'changed' : state === 'opened' ? 'opened' : isEnded ? 'never opened' : 'not opened yet'
}

export function mapAlt(name: string, rows: readonly FileRow[], isEnded: boolean): string {
  const c = countStates(rows)
  const places = rows.reduce((n, r) => n + r.count, 0)

  return `${name} is used in ${plural(places, 'place')} in ${plural(rows.length, 'file')}: ${c.changed} changed, ${c.opened} opened, ${c.never} ${isEnded ? 'never opened' : 'not opened yet'}.`
}

export function mapSvg(w: number, name: string, rows: readonly FileRow[], isEnded: boolean): string {
  const H = 310
  const cx = w / 2
  const cy = H / 2 - 4
  const rx = Math.max(70, Math.min(w / 2 - 104, 150))
  const ry = 104
  const shown = rows.slice(0, MAX_DOTS)
  const parts: string[] = [
    `<ellipse cx="${cx}" cy="${cy}" rx="${(rx * 1.42).toFixed(1)}" ry="${(ry * 1.36).toFixed(1)}" fill="none" class="l" stroke="#3a3e55" stroke-opacity="0.45" stroke-dasharray="2 5"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" class="l" stroke="#3a3e55" stroke-opacity="0.9"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${(rx * 0.5).toFixed(1)}" ry="${(ry * 0.5).toFixed(1)}" fill="none" class="l" stroke="#3a3e55" stroke-opacity="0.45" stroke-dasharray="2 5"/>`,
  ]
  const dots = shown.map((row, i) => {
    const a = (i / shown.length) * Math.PI * 2 - Math.PI / 2 + (shown.length <= 2 ? Math.PI / 2 : 0.35)
    const r = 5 + Math.min(row.count, 8) * 1.1

    return { row, r, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, cos: Math.cos(a), sin: Math.sin(a) }
  })
  for (const d of dots) {
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${d.x.toFixed(1)}" y2="${d.y.toFixed(1)}" stroke="${COLORS[d.row.state]}" stroke-opacity="0.5" stroke-width="1.4"/>`)
  }
  const poles = { top: 0, bottom: 0 }
  for (const d of dots) {
    const color = COLORS[d.row.state]
    const x = d.x.toFixed(1)
    const y = d.y.toFixed(1)
    parts.push(`<circle cx="${x}" cy="${y}" r="${(d.r * 2.1).toFixed(1)}" fill="${tint(color, 0.14)}"/>`)
    if (isEnded && d.row.state === 'never') {
      parts.push(`<circle cx="${x}" cy="${y}" r="${d.r + 2}" fill="none" stroke="${color}" stroke-width="1.4"><animate attributeName="r" values="${d.r + 2};${d.r + 13}" dur="1.6s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite"/></circle>`)
    }
    parts.push(
      d.row.state === 'never'
        ? `<circle cx="${x}" cy="${y}" r="${d.r.toFixed(1)}" fill="${tint(color, 0.25)}" stroke="${color}" stroke-width="2.2"/>`
        : `<circle cx="${x}" cy="${y}" r="${d.r.toFixed(1)}" fill="${color}"/>`,
    )
    // At the top and bottom the names sit above or below their dots, on two levels, so they do not run into each other.
    const isPole = shown.length > 6 && Math.abs(d.cos) < 0.5
    if (isPole) {
      const isTop = d.sin < 0
      const level = (isTop ? poles.top++ : poles.bottom++) % 2
      const ly = isTop ? d.y - d.r - 7 - level * 13 : d.y + d.r + 15 + level * 13
      parts.push(fileLabel(d.x, ly, fit(shortName(d.row.file), 120, 11.5, true), d.row.state, 'middle'))
    } else {
      const isRight = d.cos >= 0
      const lx = d.x + (isRight ? d.r + 6 : -(d.r + 6))
      const room = isRight ? w - lx - 2 : lx - 2
      parts.push(fileLabel(lx, d.y + 4, fit(shortName(d.row.file), room, 11.5, true), d.row.state, isRight ? 'start' : 'end'))
    }
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="26" fill="${tint(COLORS.name, 0.14)}"/>`)
  parts.push(`<circle cx="${cx}" cy="${cy}" r="11" fill="${COLORS.name}"/>`)
  const label = fit(name, 180, 12, true)
  const lw = label.length * 7.3 + 14
  parts.push(`<rect x="${(cx - lw / 2).toFixed(1)}" y="${cy + 17}" width="${lw.toFixed(1)}" height="19" rx="9.5" class="d" fill="#17181f" fill-opacity="0.92"/>`)
  parts.push(`<text x="${cx}" y="${cy + 30.5}" font-size="12" font-weight="700" ${MONO} text-anchor="middle" class="bn" fill="${COLORS.name}">${esc(label)}</text>`)
  if (rows.length > shown.length) {
    parts.push(svgText(w - 4, H - 6, `and ${plural(rows.length - shown.length, 'more file')} not drawn`, { size: 10.5, anchor: 'end' }))
  }

  return svgDoc(w, H, LIGHT + parts.join(''))
}

const ORDER: Record<FileState, number> = { changed: 0, opened: 1, never: 2 }

/** One block per file, wider for more places, coloured by what Claude did with it. */
export function barSvg(w: number, rows: readonly FileRow[]): string {
  const list = [...rows].sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.count - a.count).slice(0, 40)
  const GAP = 3
  const MIN = 8
  const total = Math.max(1, list.reduce((n, r) => n + r.count, 0))
  const room = w - GAP * Math.max(0, list.length - 1) - MIN * list.length
  let x = 0
  const blocks = list.map(r => {
    const bw = MIN + Math.max(0, room) * (r.count / total)
    const out = `<rect x="${x.toFixed(1)}" width="${bw.toFixed(1)}" height="10" rx="4" fill="${COLORS[r.state]}"/>`
    x += bw + GAP

    return out
  })

  return svgDoc(w, 10, blocks.join(''))
}
