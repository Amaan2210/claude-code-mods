import { atom, read } from 'claude-code'
import type { Elements } from 'claude-code'

import type { PitStopFlow, PitStopOffer, PitStopPoint } from '../types'
import { answerOffer, toggleMove } from './actions'
import type { Dollar, Settings } from './actions'
import { askAgainAt, changeState, classify, percentOf, tokensFmt } from './plan'
import type { Change, Entry, Plan } from './plan'
import { FRESH_FLOW } from './state'

// The state scan reads `atom` calls in the file that uses them, so each file that reads or writes
// state declares the same five atoms. Keep the shape tags in step with the other files.
const items = atom({ plugin: 'pit-stop', key: 'items' } as const, [], { shape: 'items-1' })
const moved = atom({ plugin: 'pit-stop', key: 'moved' } as const, [], { shape: 'moved-1' })
const flow = atom({ plugin: 'pit-stop', key: 'flow' } as const, FRESH_FLOW, { shape: 'flow-1' })
const history = atom({ plugin: 'pit-stop', key: 'history' } as const, [], { shape: 'history-1' })
const offers = atom({ plugin: 'pit-stop', key: 'offers' } as const, [], { shape: 'offers-1' })

export type Snap = {
  flow: PitStopFlow
  history: PitStopPoint[]
  offers: PitStopOffer[]
  plan: Plan
  change: Change
}

/** Reading these while a `ui.render` hook draws subscribes the drawing to them. */
export async function snapshot($: Dollar): Promise<Snap> {
  const [fl, list, mv, hist, offs] = await Promise.all([
    read($, flow),
    read($, items),
    read($, moved),
    read($, history),
    read($, offers),
  ])
  return { flow: fl, history: hist, offers: offs, plan: classify(list, mv, fl), change: changeState(fl) }
}

type Common = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Progress'>
type SvgTag = Elements['desktop']['Svg']

const about = (n: number) => `about ${tokensFmt(n)}`

export function statusOf(s: Snap, settings: Settings): string {
  const pct = s.flow.gauge.percent
  if (pct === undefined) return 'Memory not measured yet'
  if (s.flow.held) return 'Clean-up held'
  if (s.offers.some(o => o.status === 'asking')) return 'Good moment: now'
  if (pct >= (s.flow.askAt ?? settings.threshold)) {
    return s.change.isOpen ? 'Waiting: a change is in progress' : 'Waiting for a good moment'
  }
  return 'Watching'
}

// ---------------------------------------------------------------- pictures (desktop)

const esc = (t: string) =>
  t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

export function chartSource(s: Snap, settings: Settings): string {
  const W = 398
  const T = 14
  const H = 84
  const B = T + H
  const pts = s.history
  const minStep = pts[0]?.step ?? 0
  const maxStep = Math.max(pts[pts.length - 1]?.step ?? 1, minStep + 1)
  const x = (step: number) => 6 + ((step - minStep) / (maxStep - minStep)) * (W - 12)
  const y = (pct: number) => T + (1 - Math.min(100, Math.max(0, pct)) / 100) * H
  const thr = s.flow.askAt ?? settings.threshold
  let g = ''
  if (s.change.isOpen) {
    g += `<rect x="6" y="${T - 8}" width="${W - 12}" height="${H + 8}" rx="4" fill="#b494ff" opacity=".10"/>`
    g += `<text x="12" y="${B - 6}" font-size="10" fill="#9a86d6">change in progress</text>`
  }
  g += `<line x1="6" x2="${W - 6}" y1="${y(settings.hardLimit)}" y2="${y(settings.hardLimit)}" stroke="#ff8f8f" stroke-dasharray="3 4" opacity=".8"/>`
  g += `<text x="8" y="${y(settings.hardLimit) - 4}" font-size="10" fill="#e07a7a">Always cleaned up at ${settings.hardLimit}%</text>`
  g += `<line x1="6" x2="${W - 6}" y1="${y(thr)}" y2="${y(thr)}" stroke="#f0a35e" stroke-dasharray="3 4" opacity=".9"/>`
  g += `<text x="8" y="${y(thr) + 11}" font-size="10" fill="#c98542">Offer at ${Math.round(thr)}%</text>`
  g += `<line x1="6" x2="${W - 6}" y1="${B}" y2="${B}" stroke="#8b92a6" opacity=".5"/>`
  if (pts.length > 0) {
    const d = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.step).toFixed(1)} ${y(p.percent).toFixed(1)}`)
      .join('')
    g += `<path d="${d}" fill="none" stroke="#5aa8f0" stroke-width="2" stroke-linejoin="round"/>`
    const last = pts[pts.length - 1]
    if (last)
      g += `<circle cx="${x(last.step).toFixed(1)}" cy="${y(last.percent).toFixed(1)}" r="3.5" fill="#5aa8f0"/>`
  } else {
    g += `<text x="12" y="${T + H / 2}" font-size="11" fill="#8b92a6">No readings yet</text>`
  }
  const held = s.flow.held
  if (held && held.step >= minStep) {
    g += `<circle cx="${x(held.step).toFixed(1)}" cy="${y(held.percent).toFixed(1)}" r="4.5" fill="#f0a35e"/>`
    g += `<text x="${x(held.step).toFixed(1)}" y="${(y(held.percent) - 8).toFixed(1)}" font-size="10" text-anchor="middle" fill="#f0a35e">Held here</text>`
  }
  g += `<text x="6" y="${B + 12}" font-size="10" fill="#8b92a6">start</text>`
  g += `<text x="${W - 6}" y="${B + 12}" font-size="10" text-anchor="end" fill="#8b92a6">step ${maxStep}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${B + 18}" width="${W}" height="${B + 18}" role="img" aria-label="${esc('Memory used over time')}">${g}</svg>`
}

export function barSource(s: Snap): string {
  const W = 398
  const win = s.flow.gauge.window
  if (win <= 0) return ''
  const used = (e: Entry[]) => e.reduce((n, x) => n + x.item.tokens, 0)
  let left = 0
  let g = ''
  const seg = (tokens: number, fill: string, title: string, dashed = false) => {
    const w = Math.max(0, (tokens / win) * W)
    if (w < 0.5) return
    g += `<rect x="${left.toFixed(1)}" y="2" width="${Math.max(0, w - 1).toFixed(1)}" height="26" rx="3" fill="${dashed ? 'none' : fill}" ${dashed ? 'stroke="#8b92a6" stroke-dasharray="3 3"' : ''}><title>${esc(title)}</title></rect>`
    left += w
  }
  const stays = s.plan.stays
  seg(s.plan.otherTokens, '#2f7d6b', 'Tools, rules and other (measured minus listed)')
  stays.forEach(x =>
    seg(
      x.item.tokens,
      x.item.kind === 'file' ? '#6fd6b8' : x.item.kind === 'cmd' ? '#57b89d' : '#3f9a85',
      `${x.item.label} (stays)`,
    ),
  )
  s.plan.goes.forEach(x =>
    seg(x.item.tokens, x.item.kind === 'file' ? '#f0a35e' : '#d68b4a', `${x.item.label} (goes)`),
  )
  const rest = win - s.plan.otherTokens - used(s.plan.entries)
  seg(Math.max(0, rest), '', 'Free', true)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 30" width="${W}" height="30" role="img" aria-label="Claude's memory: what stays, what goes, what is free">${g}</svg>`
}

// ---------------------------------------------------------------- the pane

function EntryRow(ui: Common, $: Dollar, x: Entry) {
  const { Box, Text, Button } = ui
  return (
    <Box gap={1} alignItems="center">
      <Box flexGrow={1} flexDirection="column">
        <Text weight="semibold" maxLines={1}>
          {x.item.label}
        </Text>
        <Text dimColor size="caption" maxLines={1}>
          {x.why}
        </Text>
      </Box>
      <Text tabular>~{tokensFmt(x.item.tokens)}</Text>
      <Button key={`move-${x.item.id}`} onPress={() => toggleMove($, x.item.id)}>
        {x.keeps ? 'Let it go instead' : 'Keep it instead'}
      </Button>
    </Box>
  )
}

const movable = (list: Entry[]) => list.filter(x => !x.isLocked).sort((a, b) => b.item.tokens - a.item.tokens)

function Facts(ui: Common, s: Snap, settings: Settings) {
  const { Text, Progress, Box } = ui
  const g = s.flow.gauge
  const pct = g.percent
  return (
    <Box flexDirection="column">
      <Text dimColor>{statusOf(s, settings)}</Text>
      {pct === undefined ? (
        <Text>Memory is not measured yet. It shows after Claude's first answer.</Text>
      ) : (
        <Progress
          label={`Memory ${pct}% full`}
          value={pct / 100}
          valueText={
            g.tokens === undefined ? `${pct}%` : `${tokensFmt(g.tokens)} of ${tokensFmt(g.window)} (measured)`
          }
        />
      )}
      {s.flow.held && (
        <Text>
          Clean-up held: Claude is in the middle of a change ({s.change.why || 'it is not done yet'}). It runs
          when Claude reaches a stopping point, or at {settings.hardLimit}%.
        </Text>
      )}
      {s.flow.last && (
        <Text dimColor>
          Last clean-up:{' '}
          {s.flow.last.tokensBefore !== undefined && s.flow.last.tokensAfter !== undefined
            ? `${tokensFmt(s.flow.last.tokensBefore)} to ${tokensFmt(s.flow.last.tokensAfter)} (measured)`
            : `${about(s.flow.last.estimatedFreed)} freed (estimate)`}
          , {s.flow.last.dropped} {s.flow.last.dropped === 1 ? 'item' : 'items'} let go.
        </Text>
      )}
    </Box>
  )
}

function Totals(ui: Common, s: Snap) {
  const { Text } = ui
  const win = s.flow.gauge.window
  const keepTokens = s.plan.listedStays + s.plan.otherTokens
  return (
    <Text dimColor>
      Stays {about(keepTokens)} · Goes {about(s.plan.goTokens)}
      {win > 0 ? ` (${percentOf(s.plan.goTokens, win)}% of memory)` : ''} · sizes are estimates
    </Text>
  )
}

export function Pane(
  $: Dollar,
  e: { surface: string },
  ui: Common,
  svg: SvgTag | undefined,
  s: Snap,
  settings: Settings,
) {
  const { Box, Text } = ui
  const goes = movable(s.plan.goes)
  const stays = movable(s.plan.stays)
  const room = svg ? 10 : 5
  const locked = s.plan.entries.filter(x => x.isLocked)
  const lockedTokens = locked.reduce((n, x) => n + x.item.tokens, 0)
  const asking = s.offers.find(o => o.status === 'asking')
  void e

  return (
    <Box flexDirection="column" gap={1}>
      {Facts(ui, s, settings)}
      {svg && s.flow.gauge.window > 0 && (
        <Box flexDirection="column">
          {svg({
            source: chartSource(s, settings),
            alt: 'Memory used over time, with the offer line and the always-clean-up line.',
          })}
          {svg({
            source: barSource(s),
            alt: 'Claude memory split into what stays, what goes and what is free.',
          })}
        </Box>
      )}
      {Totals(ui, s)}
      <Box flexDirection="column">
        <Text weight="semibold">What goes, and why</Text>
        {goes.length === 0 && <Text dimColor>Nothing can go yet.</Text>}
        {goes.slice(0, room).map(x => EntryRow(ui, $, x))}
        {goes.length > room && <Text dimColor>and {goes.length - room} more</Text>}
      </Box>
      <Box flexDirection="column">
        <Text weight="semibold">What stays</Text>
        <Text dimColor>Your requests, decisions and open items: {about(lockedTokens)} (always stay)</Text>
        {stays.slice(0, room).map(x => EntryRow(ui, $, x))}
        {stays.length > room && <Text dimColor>and {stays.length - room} more</Text>}
      </Box>
      {asking && <Text>{asking.text} Answer in the chat.</Text>}
      <Text dimColor>
        Sizes are estimates (about 4 characters to a token). Memory fullness is measured by Claude Code.
      </Text>
    </Box>
  )
}

/** The short plain-text version, for the terminal and any surface with no pictures. */
export function PlainPane($: Dollar, ui: Common, s: Snap, settings: Settings) {
  const { Box, Text } = ui
  const pct = s.flow.gauge.percent
  const goes = movable(s.plan.goes).slice(0, 4)
  const stays = movable(s.plan.stays).slice(0, 3)
  return (
    <Box flexDirection="column">
      <Text weight="semibold">
        Pit Stop: {pct === undefined ? 'memory not measured yet' : `memory ${pct}% full`}
      </Text>
      <Text dimColor>{statusOf(s, settings)}</Text>
      {s.flow.held && (
        <Text>
          Held: Claude is in a change ({s.change.why}). Runs when it is done, or at {settings.hardLimit}%.
        </Text>
      )}
      <Text>
        Goes {about(s.plan.goTokens)} (estimate):{' '}
        {s.plan.goes.length === 0
          ? 'nothing yet'
          : s.plan.goes
              .map(x => x.item.label)
              .slice(0, 3)
              .join(', ')}
      </Text>
      {goes.map(x => EntryRow(ui, $, x))}
      <Text>Stays: your requests, decisions and open items.</Text>
      {stays.map(x => EntryRow(ui, $, x))}
    </Box>
  )
}

// ---------------------------------------------------------------- the offer in the chat

export function OfferRow($: Dollar, ui: Common, offer: PitStopOffer, settings: Settings, current: Snap) {
  const { Box, Text, Button } = ui
  const again = askAgainAt(current.flow.askAt ?? settings.threshold, settings.hardLimit)
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text weight="semibold">Pit Stop</Text>
      <Text>{offer.text}</Text>
      {offer.status === 'asking' && (
        <Box gap={1}>
          <Button
            key={`now-${offer.seq}`}
            variant="primary"
            onPress={() => answerOffer($, offer.seq, 'now', settings)}
          >
            Clean up now
          </Button>
          <Button key={`later-${offer.seq}`} onPress={() => answerOffer($, offer.seq, 'later', settings)}>
            Not yet
          </Button>
          <Text dimColor>Not yet asks again at {Math.round(again)}%.</Text>
        </Box>
      )}
      {offer.kind === 'offer' && offer.status === 'later' && (
        <Text dimColor>Not yet. I will ask again later.</Text>
      )}
      {offer.kind === 'offer' && offer.status === 'done' && <Text dimColor>Cleaned up.</Text>}
    </Box>
  )
}
