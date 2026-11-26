import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { PitStopItem, PitStopKind, PitStopOffer } from '../types'
import {
  askAgainAt,
  changeState,
  classify,
  estimate,
  keepInstructions,
  namedFiles,
  percentOf,
  tokensFmt,
} from './plan'
import { FRESH_FLOW } from './state'

// The state scan reads `atom` calls in the file that uses them, so each file that reads or writes
// state declares the same five atoms. Keep the shape tags in step with the other files.
const items = atom({ plugin: 'pit-stop', key: 'items' } as const, [], { shape: 'items-1' })
const moved = atom({ plugin: 'pit-stop', key: 'moved' } as const, [], { shape: 'moved-1' })
const flow = atom({ plugin: 'pit-stop', key: 'flow' } as const, FRESH_FLOW, { shape: 'flow-1' })
const history = atom({ plugin: 'pit-stop', key: 'history' } as const, [], { shape: 'history-1' })
const offers = atom({ plugin: 'pit-stop', key: 'offers' } as const, [], { shape: 'offers-1' })

export type Dollar = EngineInterface
export type Settings = { threshold: number; hardLimit: number }

const MAX_ITEMS = 160

/** The two settings, kept inside sane bounds. */
export function settingsOf(options: Readonly<Record<string, unknown>>): Settings {
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const hardLimit = Math.min(99, Math.max(60, num(options.hardLimit, 95)))
  const threshold = Math.min(hardLimit - 1, Math.max(30, num(options.threshold, 80)))
  return { threshold, hardLimit }
}

const short = (text: string, n = 48) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

const field = (e: unknown, name: string): string | undefined => {
  const v = (e as Record<string, unknown>)[name]
  return typeof v === 'string' && v ? v : undefined
}

function upsert(list: PitStopItem[], item: PitStopItem): PitStopItem[] {
  const rest = list.filter(x => x.id !== item.id)
  const next = [...rest, item]
  if (next.length <= MAX_ITEMS) return next
  // Fold the oldest requests into one line so the list stays short.
  const old = next.filter(x => x.kind === 'request').slice(0, next.length - MAX_ITEMS + 1)
  if (old.length < 2) return next.slice(next.length - MAX_ITEMS)
  const ids = new Set(old.map(x => x.id))
  const folded: PitStopItem = {
    id: 'earlier-requests',
    kind: 'request',
    label: 'Earlier requests',
    tokens: old.reduce((s, x) => s + x.tokens, 0),
    addedStep: old[0]?.addedStep ?? 0,
    lastStep: old[old.length - 1]?.lastStep ?? 0,
  }
  return [folded, ...next.filter(x => !ids.has(x.id))]
}

// ---------------------------------------------------------------- what fills memory

type ToolAnswer = { text?: string; deny?: string }

/** A tool call finished: remember what it put in memory. */
export async function recordTool($: Dollar, e: unknown, tool: string, ran: ToolAnswer): Promise<void> {
  if (ran.deny !== undefined) return
  const text = ran.text ?? ''
  const fl = await update($, flow, f => ({ ...f, step: f.step + 1 }))
  const step = fl.step
  const tokens = estimate(text)
  const path = field(e, 'file_path') ?? field(e, 'notebook_path') ?? field(e, 'path')

  if (tool === 'TodoWrite') {
    const raw = (e as { todos?: unknown }).todos
    const todos = Array.isArray(raw)
      ? raw.map(t => ({
          text: String((t as { content?: unknown }).content ?? ''),
          status: String((t as { status?: unknown }).status ?? 'pending'),
        }))
      : []
    const names = namedFiles(todos.map(t => t.text).join(' '))
    await update($, flow, f => ({ ...f, todos, plan: [...new Set([...f.plan, ...names])].slice(0, 60) }))
    await update($, items, list =>
      upsert(list, {
        id: 'todos',
        kind: 'todo',
        label: 'Open items',
        tokens: estimate(JSON.stringify(todos)),
        addedStep: step,
        lastStep: step,
      }),
    )
    return
  }

  if ((tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') && path) {
    await update($, flow, f => ({ ...f, edits: [...f.edits, { path, step }].slice(-60) }))
    const wrote = field(e, 'new_string') ?? field(e, 'content') ?? ''
    await update($, items, list => {
      const id = `file:${path}`
      const old = list.find(x => x.id === id)
      return upsert(list, {
        id,
        kind: 'file',
        label: short(path.split(/[\\/]/).pop() ?? path),
        path,
        tokens: (old?.tokens ?? 0) + estimate(wrote) + (old ? 0 : tokens),
        addedStep: old?.addedStep ?? step,
        lastStep: step,
        editedStep: step,
      })
    })
    return
  }

  if (tool === 'Read' && path) {
    await update($, items, list =>
      upsert(list, {
        id: `file:${path}`,
        kind: 'file',
        label: short(path.split(/[\\/]/).pop() ?? path),
        path,
        tokens,
        addedStep: step,
        lastStep: step,
        editedStep: list.find(x => x.id === `file:${path}`)?.editedStep,
      }),
    )
    return
  }

  // Everything else (Bash, Grep, Glob, web, MCP...) is command output.
  const what =
    field(e, 'command') ??
    field(e, 'pattern') ??
    field(e, 'query') ??
    field(e, 'url') ??
    field(e, 'description')
  const label = short(what ? `${tool}: ${what}` : tool)
  const kind: PitStopKind = 'cmd'
  await update($, items, list =>
    upsert(list, {
      id: `cmd:${field(e, 'tool_use_id') ?? step}`,
      kind,
      label,
      tokens,
      addedStep: step,
      lastStep: step,
      key: `${tool}|${what ?? ''}`,
    }),
  )
}

type Block = { type?: string; text?: string; input?: unknown }
const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : [])
const textOf = (blocks: Block[]) =>
  blocks.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join(' ')

/** The person's request, from `session.append`. */
export async function recordRequest($: Dollar, uuid: string, content: unknown): Promise<void> {
  const text = textOf(blocksOf(content)).trim()
  if (!text) return
  const names = namedFiles(text)
  const fl = await update($, flow, f => ({ ...f, plan: names, edits: [], todos: f.todos }))
  await update($, items, list =>
    upsert(list, {
      id: `req:${uuid}`,
      kind: 'request',
      label: short(text),
      tokens: estimate(text),
      addedStep: fl.step,
      lastStep: fl.step,
    }),
  )
}

/** Claude's own words, from `session.append`: kept as one growing note. */
export async function recordResponse($: Dollar, content: unknown): Promise<void> {
  const blocks = blocksOf(content)
  const text = textOf(blocks)
  const used = blocks.reduce(
    (s, b) => s + (b.type === 'tool_use' ? JSON.stringify(b.input ?? '').length : 0),
    0,
  )
  const tokens = estimate(text) + Math.ceil(used / 4)
  const names = namedFiles(text)
  const fl = await update($, flow, f => ({
    ...f,
    plan: names.length ? [...new Set([...f.plan, ...names])].slice(0, 60) : f.plan,
  }))
  await update($, items, list => {
    const old = list.find(x => x.id === 'notes')
    return upsert(list, {
      id: 'notes',
      kind: 'notes',
      label: "Claude's notes",
      tokens: (old?.tokens ?? 0) + tokens,
      addedStep: old?.addedStep ?? fl.step,
      lastStep: fl.step,
    })
  })
}

/** How full memory is, from `session.measure`. */
export async function recordMeasure(
  $: Dollar,
  context: { tokens?: number; window: number; percent?: number },
): Promise<void> {
  const percent =
    context.percent ?? (context.tokens !== undefined ? percentOf(context.tokens, context.window) : undefined)
  const fl = await update($, flow, f => ({
    ...f,
    gauge: { percent, tokens: context.tokens, window: context.window },
  }))
  if (percent === undefined) return
  await update($, history, list => {
    const last = list[list.length - 1]
    const point = { step: fl.step, percent }
    return (last && last.step === fl.step ? [...list.slice(0, -1), point] : [...list, point]).slice(-120)
  })
}

// ---------------------------------------------------------------- the offer and the clean-up

async function addOffer($: Dollar, offer: Omit<PitStopOffer, 'seq'>): Promise<number> {
  const fl = await update($, flow, f => ({ ...f, seq: f.seq + 1 }))
  const seq = fl.seq
  await update($, offers, list => [...list, { ...offer, seq }].slice(-20))
  try {
    await $.ui.place({ id: `offer-${seq}` })
  } catch {
    // No surface to draw on; the pane still shows the state.
  }
  return seq
}

/** The one-sentence proposal. */
export async function propose($: Dollar, settings: Settings): Promise<boolean> {
  const fl = await read($, flow)
  const pct = fl.gauge.percent
  if (pct === undefined || fl.held) return false
  if (pct < (fl.askAt ?? settings.threshold) || changeState(fl).isOpen) return false
  if ((await read($, offers)).some(o => o.status === 'asking')) return false
  const plan = classify(await read($, items), await read($, moved), fl)
  const freePercent = percentOf(plan.freeTokens, fl.gauge.window)
  if (plan.goes.length === 0 || freePercent < 1) return false
  const cmds = plan.goes.filter(x => x.item.kind === 'cmd').length
  const files = plan.goes.filter(x => x.item.kind === 'file').length
  const parts = [
    cmds ? 'old command output' : '',
    files ? `${files} ${files === 1 ? 'file' : 'files'} Claude is done with` : '',
  ].filter(Boolean)
  const text =
    `Memory is ${pct}% full. I can free about ${freePercent}% (estimate): ${parts.join(' and ')}. ` +
    'Your requests, decisions and open items all stay.'
  await addOffer($, { kind: 'offer', status: 'asking', percent: pct, freePercent, text })
  return true
}

export async function answerOffer($: Dollar, seq: number, choice: 'now' | 'later', settings: Settings) {
  if (choice === 'later') {
    await update($, flow, f => ({
      ...f,
      askAt: askAgainAt(f.askAt ?? settings.threshold, settings.hardLimit),
    }))
    await update($, offers, list => list.map(o => (o.seq === seq ? { ...o, status: 'later' as const } : o)))
    return
  }
  await update($, offers, list => list.map(o => (o.seq === seq ? { ...o, status: 'done' as const } : o)))
  await cleanUp($)
}

/**
 * Ask the engine for one clean-up, naming what stays. A plugin's own call may not pass through its own
 * `session.compact` hook, so this steers and does the bookkeeping itself, once either way.
 */
export async function cleanUp($: Dollar): Promise<boolean> {
  try {
    const before = await read($, flow)
    const plan = classify(await read($, items), await read($, moved), before)
    const out = await $.session.compact({ instructions: keepInstructions(plan, before) })
    if (out.skip !== undefined) return false
    await afterCompaction($, { goIds: plan.goes.map(x => x.item.id), freeTokens: plan.freeTokens }, out)
    return true
  } catch {
    return false
  }
}

export async function toggleMove($: Dollar, id: string): Promise<void> {
  await update($, moved, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
}

export async function hold($: Dollar, percent: number, why: string): Promise<void> {
  const fl = await read($, flow)
  if (fl.held) return
  await update($, flow, f => ({ ...f, held: { step: f.step, percent } }))
  await addOffer($, {
    kind: 'held',
    status: 'later',
    percent,
    freePercent: 0,
    text: `Memory is ${percent}% full, but Claude is in the middle of a change (${why}). I am holding the clean-up until Claude reaches a stopping point.`,
  })
}

/** After a clean-up that went through: drop what went, remember the result. */
export async function afterCompaction(
  $: Dollar,
  before: { goIds: string[]; freeTokens: number },
  out: { tokensBefore?: number; tokensAfter?: number },
): Promise<void> {
  const gone = new Set(before.goIds)
  await update($, items, list => list.filter(x => !gone.has(x.id)))
  await update($, moved, list => list.filter(x => !gone.has(x)))
  // The hold is read and cleared in one step, so a clean-up seen twice says its piece once.
  let wasHeld = false
  const fl = await update($, flow, f => {
    wasHeld = f.held !== undefined
    return {
      ...f,
      held: undefined,
      askAt: undefined,
      cleans: f.cleans + 1,
      last: {
        step: f.step,
        tokensBefore: out.tokensBefore,
        tokensAfter: out.tokensAfter,
        estimatedFreed: before.freeTokens,
        dropped: before.goIds.length,
      },
    }
  })
  if (wasHeld) {
    const after =
      out.tokensAfter !== undefined && fl.gauge.window > 0
        ? `${percentOf(out.tokensAfter, fl.gauge.window)}%`
        : 'lower'
    await addOffer($, {
      kind: 'done',
      status: 'done',
      percent: fl.gauge.percent ?? 0,
      freePercent: percentOf(before.freeTokens, fl.gauge.window),
      text: `Claude reached a stopping point, so I cleaned up. Memory is ${after}. The summary was told to keep your requests, decisions and open items.`,
    })
  }
}

export const summaryLine = (plan: ReturnType<typeof classify>, window: number) =>
  `about ${tokensFmt(plan.freeTokens)} (${percentOf(plan.freeTokens, window)}%) can go`

export { keepInstructions }
