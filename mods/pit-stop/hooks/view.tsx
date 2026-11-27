import { atom, read, update } from 'claude-code'
import type { Elements } from 'claude-code'

import type { PitStopFlow, PitStopOffer, PitStopPoint } from '../types'
import { answerOffer, toggleMove } from './actions'
import type { Dollar, Settings } from './actions'
import { askAgainAt, changeState, classify, tokensFmt } from './plan'
import type { Change, Entry, Plan } from './plan'
import { SAMPLE } from './sample'
import { FRESH_FLOW } from './state'

// The state scan reads `atom` calls in the file that uses them, so each file that reads or writes
// state declares the same atoms. Keep the shape tags in step with the other files.
const items = atom({ plugin: 'pit-stop', key: 'items' } as const, [], { shape: 'items-1' })
const moved = atom({ plugin: 'pit-stop', key: 'moved' } as const, [], { shape: 'moved-1' })
const flow = atom({ plugin: 'pit-stop', key: 'flow' } as const, FRESH_FLOW, { shape: 'flow-1' })
const history = atom({ plugin: 'pit-stop', key: 'history' } as const, [], { shape: 'history-1' })
const offers = atom({ plugin: 'pit-stop', key: 'offers' } as const, [], { shape: 'offers-1' })
const example = atom({ plugin: 'pit-stop', key: 'isExample' } as const, false)

export type Snap = {
  flow: PitStopFlow
  history: PitStopPoint[]
  offers: PitStopOffer[]
  plan: Plan
  change: Change
  /** True while the pane shows the built-in example, not the session. */
  isExample: boolean
}

/** Reading these while a `ui.render` hook draws subscribes the drawing to them. */
export async function snapshot($: Dollar): Promise<Snap> {
  const [fl, list, mv, hist, offs, isExample] = await Promise.all([
    read($, flow),
    read($, items),
    read($, moved),
    read($, history),
    read($, offers),
    read($, example),
  ])
  if (isExample) {
    return {
      flow: SAMPLE.flow,
      history: SAMPLE.history,
      offers: SAMPLE.offers,
      plan: classify(SAMPLE.items, [], SAMPLE.flow),
      change: changeState(SAMPLE.flow),
      isExample: true,
    }
  }
  return { flow: fl, history: hist, offers: offs, plan: classify(list, mv, fl), change: changeState(fl), isExample: false }
}

/** Shows the built-in example in the pane, or goes back to the session. */
export function setExample($: Dollar, isExample: boolean): Promise<boolean> {
  return update($, example, () => isExample)
}

export async function closeExample($: Dollar): Promise<void> {
  if (await read($, example)) await update($, example, () => false)
}

type Common = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Progress'>

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

/** The short plain-text version, for the terminal and any surface with no pictures. */
export function PlainPane($: Dollar, ui: Common, s: Snap, settings: Settings) {
  const { Box, Text } = ui
  const pct = s.flow.gauge.percent
  const goes = movable(s.plan.goes).slice(0, 4)
  const stays = movable(s.plan.stays).slice(0, 3)
  return (
    <Box flexDirection="column">
      <Text weight="semibold">
        Pit Stop{s.isExample ? ' (example)' : ''}: {pct === undefined ? 'memory not measured yet' : `memory ${pct}% full`}
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
  const tone = offer.kind === 'held' ? '#b494ff' : '#6fd696'
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tone} paddingX={2} paddingY={1}>
      <Text weight="semibold" size="caption" color={tone}>
        PIT STOP
      </Text>
      <Text>{offer.text}</Text>
      {offer.status === 'asking' && (
        <Box gap={1} alignItems="center">
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
