// The picture of one changed name: it sits in the middle and every file that
// uses it is a dot around it, coloured by what Claude did with the file.
import type { FileRow, FileState } from './model'
import { plural, shortName } from './model'

export const COLORS = {
  changed: '#6fd696',
  opened: '#6fb7ff',
  never: '#ff7a59',
  name: '#ffe7a8',
  grey: '#8d8d99',
} as const

export const MAX_DOTS = 16

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}...` : s)

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

export function mapSvg(name: string, rows: readonly FileRow[], picked: string | null, isEnded: boolean): string {
  const W = 400
  const H = 320
  const cx = W / 2
  const cy = H / 2 - 4
  const shown = rows.slice(0, MAX_DOTS)
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" rx="12" fill="#16161b"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="112" ry="100" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>`,
  ]
  const dots = shown.map((row, i) => {
    const a = (i / shown.length) * Math.PI * 2 - Math.PI / 2
    const r = 5 + Math.min(row.count, 8) * 1.2

    return { row, r, x: cx + Math.cos(a) * 112, y: cy + Math.sin(a) * 100, cos: Math.cos(a) }
  })
  for (const d of dots) {
    const color = COLORS[d.row.state]
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${d.x.toFixed(1)}" y2="${d.y.toFixed(1)}" stroke="${color}" stroke-opacity="0.45" stroke-width="${d.row.file === picked ? 2.5 : 1.2}"/>`)
  }
  for (const d of dots) {
    const color = COLORS[d.row.state]
    const x = d.x.toFixed(1)
    const y = d.y.toFixed(1)
    parts.push(`<circle cx="${x}" cy="${y}" r="${(d.r * 2.6).toFixed(1)}" fill="${color}" fill-opacity="0.12"/>`)
    if (isEnded && d.row.state === 'never') {
      parts.push(`<circle cx="${x}" cy="${y}" r="${d.r + 2}" fill="none" stroke="${color}" stroke-width="1.4"><animate attributeName="r" values="${d.r + 2};${d.r + 12}" dur="1.6s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite"/></circle>`)
    }
    parts.push(`<circle cx="${x}" cy="${y}" r="${d.r.toFixed(1)}" fill="${color}"${d.row.file === picked ? ' stroke="#ffffff" stroke-width="2"' : ''}/>`)
    const label = esc(cut(shortName(d.row.file), 18))
    const lx = d.x + (d.cos >= 0 ? d.r + 4 : -(d.r + 4))
    parts.push(`<text x="${lx.toFixed(1)}" y="${(d.y + 4).toFixed(1)}" font-size="10" font-family="Consolas, monospace" text-anchor="${d.cos >= 0 ? 'start' : 'end'}" fill="${d.row.file === picked ? '#ffffff' : '#cfced6'}" stroke="#16161b" stroke-width="3" paint-order="stroke">${label}</text>`)
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="30" fill="${COLORS.name}" fill-opacity="0.16"/>`)
  parts.push(`<circle cx="${cx}" cy="${cy}" r="12" fill="${COLORS.name}"/>`)
  parts.push(`<text x="${cx}" y="${cy + 28}" font-size="11" font-weight="600" font-family="Consolas, monospace" text-anchor="middle" fill="${COLORS.name}" stroke="#16161b" stroke-width="3" paint-order="stroke">${esc(cut(name, 26))}</text>`)
  if (rows.length > shown.length) {
    parts.push(`<text x="${W - 10}" y="${H - 10}" font-size="10" text-anchor="end" fill="#a5a39c">and ${plural(rows.length - shown.length, 'more file')} not drawn</text>`)
  }
  parts.push('</svg>')

  return parts.join('')
}
