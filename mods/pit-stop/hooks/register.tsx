import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  afterCompaction,
  cleanUp,
  hold,
  keepInstructions,
  propose,
  recordMeasure,
  recordRequest,
  recordResponse,
  recordTool,
  settingsOf,
} from './actions'
import { MAX_HOLD_STEPS, STEER_MARK, changeState, classify, tokensFmt } from './plan'
import { FRESH_FLOW } from './state'
import { Pane } from './pane'
import { OfferRow, PlainPane, closeExample, snapshot } from './view'

// The state scan reads `atom` calls in the file that uses them, so each file that reads or writes
// state declares the same five atoms. Keep the shape tags in step with the other files.
const items = atom({ plugin: 'pit-stop', key: 'items' } as const, [], { shape: 'items-1' })
const moved = atom({ plugin: 'pit-stop', key: 'moved' } as const, [], { shape: 'moved-1' })
const flow = atom({ plugin: 'pit-stop', key: 'flow' } as const, FRESH_FLOW, { shape: 'flow-1' })
const history = atom({ plugin: 'pit-stop', key: 'history' } as const, [], { shape: 'history-1' })
const offers = atom({ plugin: 'pit-stop', key: 'offers' } as const, [], { shape: 'offers-1' })

const PANE = 'pit-stop'

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pit-stop',
      description: "Show what fills Claude's memory, what goes and what stays",
    })
    return next(e)
  })

  on('command.run', { command: 'pit-stop' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Pit Stop' })
    const s = await snapshot($)
    const pct = s.flow.gauge.percent
    return {
      text:
        pct === undefined
          ? 'Pit Stop is open. Memory is not measured yet.'
          : `Pit Stop is open. Memory is ${pct}% full; about ${tokensFmt(s.plan.goTokens)} could go (estimate).`,
    }
  })

  // ---- what fills memory

  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) {
      try {
        await recordTool($, e, String(e.tool), ran)
      } catch {
        // Bookkeeping must never fail a tool call.
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined) return stored
    try {
      if (e.door === 'prompt' && e.message.role === 'user' && !e.message.isMeta) {
        await recordRequest($, e.uuid, e.message.content)
      } else if (e.door === 'response' && e.message.role === 'assistant') {
        await recordResponse($, e.message.content)
      }
    } catch {
      // Bookkeeping only.
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    try {
      if (e.changed.includes('context')) await recordMeasure($, e.context)
    } catch {
      // Bookkeeping only.
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, flow, f => ({ ...f, isTurnOpen: true }))
      // Real work has started: the example makes way for it.
      await closeExample($)
    }
    return next(e)
  })

  // A turn has ended: the one good moment to offer, or to run a held clean-up.
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId !== undefined) return out
    try {
      await update($, flow, f => ({ ...f, isTurnOpen: false }))
      const fl = await read($, flow)
      if (fl.held) {
        // Claude has stopped, so nothing is half-written: run the held clean-up now, whatever the
        // to-do list says. A clean-up the mod asks for is never held; one that goes through clears
        // the hold, and one that does not must not leave it standing.
        await cleanUp($)
        await update($, flow, f => ({ ...f, held: undefined }))
      } else {
        await propose($, settings)
      }
    } catch {
      // Never fail a turn over this.
    }
    return out
  })

  // ---- the clean-up

  // If this hook fails, the catch hands back what the engine already settled: nothing runs twice.
  on('session.compact', async ($, e, next) => {
    // A subagent's own transcript, and the precompute dispatch, are not ours.
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)

    const fl = await read($, flow)
    const plan = classify(await read($, items), await read($, moved), fl)
    const pct = fl.gauge.percent

    // HOLD: only the engine's automatic clean-up can be held, only while Claude is mid-change,
    // never at or past the hard limit, and never for more than MAX_HOLD_STEPS steps.
    if (e.trigger === 'auto') {
      const change = changeState(fl)
      const heldFor = fl.held ? fl.step - fl.held.step : 0
      const isBelowLimit = pct !== undefined && pct < settings.hardLimit
      if (change.isOpen && isBelowLimit && heldFor < MAX_HOLD_STEPS) {
        await hold($, pct, change.why)
        return { skip: `Pit Stop held the clean-up: Claude is in the middle of a change (${change.why}).` }
      }
    }

    const steer = keepInstructions(plan, fl)
    const instructions = e.instructions ? `${e.instructions}\n\n${steer}` : steer
    // The engine fills `messages` on every compaction; a bare call (a test's) has none to pass on.
    const { messages: given, ...rest } = e
    const messages = Array.isArray(given) ? given : await $.session.messages()
    const out = await next({ ...rest, messages, instructions })
    if (out.skip === undefined) {
      try {
        await afterCompaction($, { goIds: plan.goes.map(x => x.item.id), freeTokens: plan.freeTokens }, out)
      } catch {
        // Bookkeeping only.
      }
    }
    return out
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, items, () => [])
      await update($, moved, () => [])
      await update($, history, () => [])
      await update($, offers, () => [])
      await update($, flow, () => FRESH_FLOW)
    }
    return next(e)
  })

  // ---- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await snapshot($)
    const ui = $.ui.resolve(e)
    if (e.surface === 'terminal') return PlainPane($, ui, s, settings)
    return Pane($, $.ui.resolve(e), s, settings, e.props.bodyColumns)
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'pit-stop' || !e.props.id.startsWith('offer-')) return next(e)
    const seq = Number(e.props.id.slice('offer-'.length))
    const s = await snapshot($)
    const offer = s.offers.find(o => o.seq === seq)
    const ui = $.ui.resolve(e)
    if (!offer) return ui.Text({ dimColor: true, children: 'Pit Stop' })
    return OfferRow($, ui, offer, settings, s)
  })
}
