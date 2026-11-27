// The rich pane, for surfaces that can draw pictures.
import type { PitStopOffer } from '../types'
import { answerOffer, toggleMove } from './actions'
import type { Dollar, Settings } from './actions'
import { TONE, fit, heading, pillSvg, svgDoc, svgLine, svgText, tint, widthOf } from './kit'
import type { Rich } from './kit'
import { percentOf, tokensFmt } from './plan'
import type { Entry } from './plan'
import { setExample, statusOf } from './view'
import type { Snap } from './view'

const TEAL = { deep: '#2f8d79', mid: '#57b89d', light: '#6fd6b8' }
const AMBER = '#f0a35e'

const statusTone = (status: string): string =>
  status.startsWith('Good moment') ? TONE.ok : status.startsWith('Clean-up held') ? TONE.pro : status.startsWith('Waiting') ? TONE.warn : TONE.grey

// ---------------------------------------------------------------- pictures

/** Memory used over time, with the line an offer is made at and the line a clean-up always runs at. */
export function chartSource(w: number, s: Snap, settings: Settings): string {
  const T = 18
  const H = 84
  const B = T + H
  const L = 4
  const R = w - 4
  const pts = s.history
  const minStep = pts[0]?.step ?? 0
  const maxStep = Math.max(pts[pts.length - 1]?.step ?? 1, minStep + 1)
  // The line stops short of the right edge: the room left is what is still to come.
  const x = (step: number) => L + ((step - minStep) / (maxStep - minStep)) * (R - L) * 0.86
  const y = (pct: number) => T + (1 - Math.min(100, Math.max(0, pct)) / 100) * H
  const thr = s.flow.askAt ?? settings.threshold
  const isAsking = s.offers.some(o => o.status === 'asking')
  let g = ''
  if (s.change.isOpen) {
    g += `<rect x="${L}" y="${T}" width="${R - L}" height="${H}" rx="4" fill="${tint(TONE.pro, 0.1)}"/>`
    g += svgText(R - 6, B - 7, 'a change is in progress', { fill: TONE.pro, size: 10.5, anchor: 'end' })
  }
  g += `<line x1="${L}" x2="${R}" y1="${y(settings.hardLimit)}" y2="${y(settings.hardLimit)}" stroke="${TONE.bad}" stroke-dasharray="3 4" opacity=".85"/>`
  g += svgText(L + 4, y(settings.hardLimit) - 5, `Always cleaned up at ${settings.hardLimit}%`, { fill: TONE.bad, size: 10.5 })
  if (thr < settings.hardLimit - 4) {
    g += `<line x1="${L}" x2="${R}" y1="${y(thr)}" y2="${y(thr)}" stroke="${TONE.warn}" stroke-dasharray="3 4" opacity=".8"/>`
    g += svgText(L + 4, y(thr) + 13, `Offer at ${Math.round(thr)}%`, { fill: TONE.warn, size: 10.5 })
  }
  g += svgLine(L, B, R, B)
  const last = pts[pts.length - 1]
  if (last) {
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.step).toFixed(1)} ${y(p.percent).toFixed(1)}`).join('')
    const first = pts[0] ?? last
    g += `<path d="${line}L${x(last.step).toFixed(1)} ${B}L${x(first.step).toFixed(1)} ${B}Z" fill="${tint(TONE.info, 0.14)}"/>`
    g += `<path d="${line}" fill="none" stroke="${TONE.info}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    const tone = isAsking ? TONE.ok : s.flow.held ? TONE.pro : TONE.info
    const lx = x(last.step)
    const ly = y(last.percent)
    if (isAsking) {
      g += `<line x1="${lx.toFixed(1)}" x2="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" y2="${B}" stroke="${TONE.ok}" stroke-dasharray="2 3"/>`
      g += svgText(lx - 6, B - 7, 'Good moment: now', { fill: TONE.ok, size: 10.5, anchor: 'end' })
    }
    g += `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="7" fill="${tint(tone, 0.25)}"/>`
    g += `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="${tone}"/>`
  } else {
    g += svgText(w / 2, T + H / 2 + 4, 'No readings yet', { size: 11.5, anchor: 'middle' })
  }
  const held = s.flow.held
  if (held && held.step >= minStep) {
    g += `<circle cx="${x(held.step).toFixed(1)}" cy="${y(held.percent).toFixed(1)}" r="4.5" fill="none" stroke="${TONE.pro}" stroke-width="2"/>`
    g += svgText(x(held.step), y(held.percent) + 17, 'held here', { fill: TONE.pro, size: 10.5, anchor: 'middle' })
  }
  g += svgText(L, B + 13, 'start', { size: 10.5 })
  if (last) g += svgText(x(last.step), B + 13, `step ${maxStep}`, { size: 10.5, anchor: 'middle' })
  return svgDoc(w, B + 18, g)
}

type Block = { label: string; tokens: number; fill: string; ink: string; isHatched?: boolean }
type Placed = Block & { x: number; y: number; w: number; h: number }

/** Splits a rectangle among blocks by size: the bigger half first, along the longer side. */
function lay(blocks: Block[], x: number, y: number, w: number, h: number, out: Placed[]): void {
  const first = blocks[0]
  if (!first) return
  if (blocks.length === 1) {
    out.push({ ...first, x, y, w, h })
    return
  }
  const total = blocks.reduce((n, b) => n + b.tokens, 0)
  let at = 0
  let sum = 0
  while (at < blocks.length - 1 && sum + (blocks[at]?.tokens ?? 0) / 2 < total / 2) {
    sum += blocks[at]?.tokens ?? 0
    at += 1
  }
  at = Math.max(1, at)
  sum = blocks.slice(0, at).reduce((n, b) => n + b.tokens, 0)
  const share = total > 0 ? sum / total : 0.5
  if (w >= h * 1.15) {
    lay(blocks.slice(0, at), x, y, w * share, h, out)
    lay(blocks.slice(at), x + w * share, y, w * (1 - share), h, out)
  } else {
    lay(blocks.slice(0, at), x, y, w, h * share, out)
    lay(blocks.slice(at), x, y + h * share, w, h * (1 - share), out)
  }
}

const top = (list: Block[], most: number, restLabel: string): Block[] => {
  const sorted = [...list].filter(b => b.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  if (sorted.length <= most) return sorted
  const rest = sorted.slice(most - 1)
  const lead = sorted[0]
  if (!lead) return sorted
  return [...sorted.slice(0, most - 1), { ...(rest[0] ?? lead), label: `${rest.length} ${restLabel}`, tokens: rest.reduce((n, b) => n + b.tokens, 0) }]
}

/** Claude's memory as blocks: what stays, what goes, what is free. A bigger block takes more memory. */
export function blocksSource(w: number, s: Snap): string {
  const H = 196
  const TOP = 20
  const win = s.flow.gauge.window
  const locked = s.plan.entries.filter(e => e.isLocked).reduce((n, e) => n + e.item.tokens, 0)
  const stays: Block[] = top(
    [
      { label: 'Tools and rules', tokens: s.plan.otherTokens, fill: TEAL.deep, ink: '#eafff8' },
      { label: 'Your requests', tokens: locked, fill: TEAL.mid, ink: '#06241d' },
      ...s.plan.stays.filter(e => !e.isLocked).map(e => ({ label: e.item.label, tokens: e.item.tokens, fill: TEAL.light, ink: '#06241d' })),
    ],
    8,
    'more',
  )
  const goes: Block[] = top(
    s.plan.goes.map(e => ({ label: e.item.label, tokens: e.item.tokens, fill: AMBER, ink: '#2a1606', isHatched: true })),
    9,
    'more',
  )
  const stayTokens = stays.reduce((n, b) => n + b.tokens, 0)
  const goTokens = goes.reduce((n, b) => n + b.tokens, 0)
  const free = Math.max(0, win - stayTokens - goTokens)
  const GAP = 4
  const parts = [
    { tokens: stayTokens, min: stayTokens > 0 ? 84 : 0 },
    { tokens: goTokens, min: goTokens > 0 ? 84 : 0 },
    { tokens: free, min: free > 0 ? 62 : 0 },
  ]
  const shown = parts.filter(p => p.tokens > 0).length
  const room = w - GAP * Math.max(0, shown - 1)
  const total = Math.max(1, stayTokens + goTokens + free)
  let widths = parts.map(p => (p.tokens / total) * room)
  for (let i = 0; i < 3; i += 1) {
    const short = widths.reduce((n, v, k) => n + Math.max(0, (parts[k]?.min ?? 0) - v), 0)
    const spare = widths.reduce((n, v, k) => n + Math.max(0, v - (parts[k]?.min ?? 0)), 0)
    if (short < 0.5 || spare <= 0) break
    widths = widths.map((v, k) => {
      const min = parts[k]?.min ?? 0
      return v < min ? min : v - ((v - min) / spare) * short
    })
  }
  const [wStay = 0, wGo = 0, wFree = 0] = widths
  let g =
    '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<rect width="2.2" height="7" fill="#000" opacity="0.16"/></pattern></defs>'
  let left = 0
  const region = (blocks: Block[], width: number, title: string, tone: string) => {
    if (width <= 0) return
    g += svgText(left + 2, 12, fit(title, width - 4, 11), { fill: tone, size: 11, weight: 700 })
    const placed: Placed[] = []
    lay(blocks, left, TOP, width, H - TOP, placed)
    for (const b of placed) {
      const bx = b.x + 1
      const by = b.y + 1
      const bw = Math.max(1, b.w - 2)
      const bh = Math.max(1, b.h - 2)
      g += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${b.fill}"/>`
      if (b.isHatched) g += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="url(#hatch)"/>`
      if (bw > 34 && bh > 17) g += svgText(bx + 6, by + 14, fit(b.label, bw - 10, 11, true), { fill: b.ink, size: 11, weight: 600, mono: true })
      if (bw > 34 && bh > 32) g += svgText(bx + 6, by + 27, tokensFmt(b.tokens), { fill: b.ink, size: 10.5 })
    }
    left += width + GAP
  }
  region(stays, wStay, `STAYS · ${tokensFmt(stayTokens)} · ${percentOf(stayTokens, win)}%`, TEAL.light)
  region(goes, wGo, `GOES · ${tokensFmt(goTokens)} · ${percentOf(goTokens, win)}%`, AMBER)
  if (wFree > 0) {
    g += svgText(left + 2, 12, 'FREE', { size: 11, weight: 700 })
    g += `<rect x="${(left + 1).toFixed(1)}" y="${TOP + 1}" width="${Math.max(1, wFree - 2).toFixed(1)}" height="${H - TOP - 2}" rx="4" fill="none" class="l" stroke="#3a3e55" stroke-dasharray="4 4"/>`
    g += svgText(left + wFree / 2, TOP + (H - TOP) / 2 + 4, `${percentOf(free, win)}% free`, { size: 11.5, anchor: 'middle' })
  }
  return svgDoc(w, H, g)
}

// ---------------------------------------------------------------- the pane

const movable = (list: Entry[]) => list.filter(x => !x.isLocked).sort((a, b) => b.item.tokens - a.item.tokens)
const sum = (list: Entry[]) => list.reduce((n, x) => n + x.item.tokens, 0)
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function entryRow(el: Rich, $: Dollar, x: Entry, tone: string, canMove: boolean) {
  const { Box, Text, Button } = el
  return (
    <Box key={`row-${x.item.id}`} gap={1} alignItems="center" hover={{ backgroundColor: tint(TONE.grey, 0.12) }}>
      <Text color={tone}>■</Text>
      <Box flexGrow={1} flexDirection="column">
        <Text size="footnote" mono weight="semibold" wrap="truncate-end">
          {x.item.label}
        </Text>
        <Text size="caption" dimColor wrap="truncate-end">
          {x.why}
        </Text>
      </Box>
      <Text size="footnote" tabular>
        {tokensFmt(x.item.tokens)}
      </Text>
      {canMove ? (
        <Button key={`move-${x.item.id}`} onPress={() => toggleMove($, x.item.id)}>
          {x.keeps ? 'Let it go' : 'Keep it'}
        </Button>
      ) : null}
    </Box>
  )
}

function totalRow(el: Rich, tone: string, label: string, tokens: number) {
  const { Box, Text } = el
  return (
    <Box gap={1} alignItems="center">
      <Text color={tone}>■</Text>
      <Box flexGrow={1}>
        <Text>{label}</Text>
      </Box>
      <Text weight="semibold" tabular>
        {tokensFmt(tokens)}
      </Text>
    </Box>
  )
}

function offerCard(el: Rich, $: Dollar, offer: PitStopOffer, settings: Settings, isExample: boolean) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tint(TONE.ok, 0.6)} backgroundColor={tint(TONE.ok, 0.06)} paddingX={2} paddingY={1}>
      <Text size="caption" weight="bold" color={TONE.ok}>
        A GOOD MOMENT TO CLEAN UP
      </Text>
      <Text>{offer.text}</Text>
      {isExample ? (
        <Text size="footnote" dimColor>
          In a real session two buttons sit here: Clean up now, and Not yet.
        </Text>
      ) : (
        <Box gap={1} alignItems="center">
          <Button key="pane-now" variant="primary" onPress={() => answerOffer($, offer.seq, 'now', settings)}>
            Clean up now
          </Button>
          <Button key="pane-later" onPress={() => answerOffer($, offer.seq, 'later', settings)}>
            Not yet
          </Button>
        </Box>
      )}
    </Box>
  )
}

export function Pane($: Dollar, el: Rich, s: Snap, settings: Settings, columns?: number) {
  const { Box, Text, Button, Svg } = el
  const w = widthOf(columns)
  const g = s.flow.gauge
  const pct = g.percent
  const status = statusOf(s, settings)
  const goes = movable(s.plan.goes)
  const stays = movable(s.plan.stays)
  const locked = s.plan.entries.filter(x => x.isLocked)
  const asking = s.offers.find(o => o.status === 'asking')
  const thr = s.flow.askAt ?? settings.threshold
  const goFiles = s.plan.goes.filter(x => x.item.kind === 'file')
  const goCmds = s.plan.goes.filter(x => x.item.kind === 'cmd')
  const isMeasured = pct !== undefined && g.window > 0
  const canMove = !s.isExample
  const hasLists = isMeasured || s.plan.entries.length > 0

  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1} alignItems="center">
          <Text size="caption" weight="semibold" dimColor>
            PIT STOP
          </Text>
          {s.isExample ? <Svg source={pillSvg('Example', TONE.info)} alt="This is an example, not your session" /> : null}
        </Box>
        {s.isExample ? (
          <Button key="clear-example" label="Close the example" onPress={() => setExample($, false)} />
        ) : (
          <Svg source={pillSvg(status, statusTone(status))} alt={status} />
        )}
      </Box>

      {isMeasured ? (
        <Box gap={1} alignItems="flex-end">
          <Text size="title" weight="bold" tabular>
            {g.tokens === undefined ? `Memory ${pct}% full` : `${tokensFmt(g.tokens)} of ${tokensFmt(g.window)} · ${pct}% full`}
          </Text>
          <Text dimColor>{pct >= thr ? `past the ${Math.round(thr)}% line` : `offer at ${Math.round(thr)}%`}</Text>
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          <Text size="title" weight="bold">
            Memory not measured yet
          </Text>
          <Text dimColor>
            Memory is not measured yet. It shows after Claude's first answer: how full it is, what would go in a clean-up, and what stays.
          </Text>
          <Box>
            <Button key="example" label="See an example" onPress={() => setExample($, true)} />
          </Box>
        </Box>
      )}

      {isMeasured ? <Svg source={chartSource(w, s, settings)} alt="Memory used over time, with the offer line and the always-clean-up line." /> : null}
      {isMeasured ? <Svg source={blocksSource(w, s)} alt="Claude's memory as blocks: what stays, what goes and what is free." /> : null}

      {s.flow.held ? (
        <Box flexDirection="column" borderStyle="round" borderColor={tint(TONE.pro, 0.6)} backgroundColor={tint(TONE.pro, 0.07)} paddingX={2} paddingY={1}>
          <Text size="caption" weight="bold" color={TONE.pro}>
            CLEAN-UP HELD
          </Text>
          <Text>
            Clean-up held: Claude is in the middle of a change ({s.change.why || 'it is not done yet'}). It runs when Claude reaches a stopping point, or at{' '}
            {settings.hardLimit}%.
          </Text>
        </Box>
      ) : null}
      {asking ? offerCard(el, $, asking, settings, s.isExample) : null}

      {hasLists ? (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tint(TONE.grey, 0.35)} backgroundColor={tint(TONE.grey, 0.06)} paddingX={2} paddingY={1}>
            <Text weight="semibold">What goes, and why</Text>
            {goes.length === 0 ? (
              <Text dimColor>Nothing can go yet.</Text>
            ) : (
              <Box flexDirection="column">
                {goFiles.length ? totalRow(el, AMBER, count(goFiles.length, 'file Claude is done with', 'files Claude is done with'), sum(goFiles)) : null}
                {goCmds.length ? totalRow(el, '#d68b4a', count(goCmds.length, 'old command output', 'old command outputs'), sum(goCmds)) : null}
              </Box>
            )}
            {goes.length ? (
              <Box flexDirection="column">
                {heading(el, 'Each one', canMove ? 'keep one if you still need it' : '')}
                {goes.slice(0, 6).map(x => entryRow(el, $, x, AMBER, canMove))}
                {goes.length > 6 ? (
                  <Text size="footnote" dimColor>
                    and {goes.length - 6} more
                  </Text>
                ) : null}
              </Box>
            ) : null}
          </Box>

          <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tint(TONE.grey, 0.35)} backgroundColor={tint(TONE.grey, 0.06)} paddingX={2} paddingY={1}>
            <Text weight="semibold">What stays</Text>
            <Box flexDirection="column">
              {s.plan.otherTokens > 0 ? totalRow(el, TEAL.deep, 'Tools, rules and the rest', s.plan.otherTokens) : null}
              {totalRow(el, TEAL.mid, 'Your requests, decisions and open items (always stay)', sum(locked))}
            </Box>
            {stays.length ? (
              <Box flexDirection="column">
                {heading(el, 'Files and output in use')}
                {stays.slice(0, 5).map(x => entryRow(el, $, x, TEAL.light, canMove))}
                {stays.length > 5 ? (
                  <Text size="footnote" dimColor>
                    and {stays.length - 5} more
                  </Text>
                ) : null}
              </Box>
            ) : null}
          </Box>

        </Box>
      ) : null}

      {s.flow.last ? (
        <Text size="footnote" dimColor>
          Last clean-up:{' '}
          {s.flow.last.tokensBefore !== undefined && s.flow.last.tokensAfter !== undefined
            ? `${tokensFmt(s.flow.last.tokensBefore)} to ${tokensFmt(s.flow.last.tokensAfter)} (measured)`
            : `about ${tokensFmt(s.flow.last.estimatedFreed)} freed (estimate)`}
          , {s.flow.last.dropped} {s.flow.last.dropped === 1 ? 'item' : 'items'} let go.
        </Text>
      ) : null}
      <Text size="footnote" dimColor>
        Block and item sizes are estimates (about 4 characters to a token). How full memory is comes from Claude Code.
      </Text>
    </Box>
  )
}
