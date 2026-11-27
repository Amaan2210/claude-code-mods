// Drawing helpers for the rich pane. The same file sits in each mod of this repo.
import type { ElementTable } from 'claude-code'

export type Rich = Pick<ElementTable<'desktop'>, 'Box' | 'Text' | 'Button' | 'Svg'>

export const TONE = {
  ok: '#6fd696',
  warn: '#f0b35e',
  bad: '#ff7a6b',
  info: '#6fb7ff',
  pro: '#b494ff',
  pink: '#ff6fb1',
  cyan: '#5fd8ff',
  grey: '#8d95ad',
} as const

/** A colour with see-through, so it sits on a dark and on a light pane alike. */
export const tint = (hex: string, alpha: number): string =>
  `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`

/** Pixels a drawing may take: the pane's columns, at about 8 pixels each. */
export const widthOf = (columns: number | undefined): number =>
  Math.max(300, Math.min(760, Math.round((columns && columns > 0 ? columns : 59) * 8)))

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Cuts a text to about `px` pixels at a font size: a drawing cannot wrap or measure. */
export const fit = (s: string, px: number, size = 12, mono = false): string => {
  const room = Math.max(1, Math.floor(px / (size * (mono ? 0.6 : 0.54))))
  return s.length > room ? `${s.slice(0, Math.max(1, room - 1))}…` : s
}

// Text in a drawing is light by default and switches on a light pane, where the app says so.
const INK = { t: '#e6e8f0', s: '#b4b9c9', m: '#9097ab', f: '#6f768a' } as const
const STYLE =
  '<style>@media (prefers-color-scheme: light){.t{fill:#1d2130}.s{fill:#454b5e}.m{fill:#687086}.f{fill:#8a91a3}' +
  '.l{stroke:#c5cad6}.w{fill:#eceef4}.d{fill:#ffffff}}</style>'

export type Ink = keyof typeof INK

export const svgDoc = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
  `font-family="system-ui, 'Segoe UI', sans-serif">${STYLE}${body}</svg>`

export const svgText = (
  x: number,
  y: number,
  text: string,
  o: { ink?: Ink; fill?: string; size?: number; weight?: number; anchor?: 'start' | 'middle' | 'end'; mono?: boolean } = {},
): string =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size ?? 11.5}"` +
  (o.weight ? ` font-weight="${o.weight}"` : '') +
  (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
  (o.mono ? ` font-family="'Cascadia Mono', Consolas, monospace"` : '') +
  (o.fill ? ` fill="${o.fill}"` : ` class="${o.ink ?? 'm'}" fill="${INK[o.ink ?? 'm']}"`) +
  `>${esc(text)}</text>`

/** A thin line that follows the pane's theme. */
export const svgLine = (x1: number, y1: number, x2: number, y2: number, dash = ''): string =>
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="l" stroke="#3a3e55"` +
  (dash ? ` stroke-dasharray="${dash}"` : '') +
  '/>'

/** A round badge with one glyph: the mark in front of a row. */
export const badge = (glyph: string, tone: string, isQuiet = false): string =>
  svgDoc(
    16,
    16,
    isQuiet
      ? `<circle cx="8" cy="8" r="7" fill="${tint(tone, 0.2)}"/><text x="8" y="11.6" text-anchor="middle" font-size="10" font-weight="700" fill="${tone}">${esc(glyph)}</text>`
      : `<circle cx="8" cy="8" r="7.5" fill="${tone}"/><text x="8" y="11.6" text-anchor="middle" font-size="10" font-weight="700" fill="#111318">${esc(glyph)}</text>`,
  )

/** A row of equal blocks, one per item, each in its own colour: how many are done at a glance. */
export const meter = (w: number, tones: readonly string[], h = 7): string => {
  const n = Math.max(1, tones.length)
  const gap = 3
  const each = (w - gap * (n - 1)) / n
  const blocks = Array.from({ length: n }, (_, i) => {
    const tone = tones[i]
    const x = (i * (each + gap)).toFixed(1)
    return tone
      ? `<rect x="${x}" width="${each.toFixed(1)}" height="${h}" rx="3" fill="${tone}"/>`
      : `<rect x="${x}" width="${each.toFixed(1)}" height="${h}" rx="3" class="w" fill="#2a2c39"/>`
  })
  return svgDoc(w, h, blocks.join(''))
}

/** A small filled label: a status, drawn so it looks the same everywhere. */
export const pillSvg = (text: string, tone: string): string => {
  const w = Math.round(text.length * 6.4 + 22)
  return svgDoc(
    w,
    22,
    `<rect width="${w}" height="22" rx="11" fill="${tint(tone, 0.16)}"/>` +
      `<text x="${w / 2}" y="15" text-anchor="middle" font-size="12" font-weight="600" fill="${tone}">${esc(text)}</text>`,
  )
}

/** A section's small heading, with an optional quiet note at the right. */
export function heading(el: Rich, text: string, note = '') {
  const { Box, Text } = el
  return (
    <Box justifyContent="space-between" alignItems="center">
      <Text size="caption" weight="semibold" dimColor>
        {text.toUpperCase()}
      </Text>
      {note ? (
        <Text size="caption" dimColor>
          {note}
        </Text>
      ) : null}
    </Box>
  )
}
