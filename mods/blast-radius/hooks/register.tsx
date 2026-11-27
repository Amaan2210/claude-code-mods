import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { stateWords, countStates } from './map'
import {
  EMPTY_RUN, checkPrompt, keyOf, neverOpened, noteForAll, plural, questionFor, rowsFor,
} from './model'
import { isCodeFile, namesChangedByEdit, namesChangedByWrite } from './names'
import type { EditPart } from './names'
import type { BlastSeen, BlastView } from '../types'
import { richPane } from './pane'
import { SAMPLE_RUN, SAMPLE_SEEN } from './sample'
import { findUses } from './search'
import type { Found } from './search'

const PANE = 'blast-radius'

// The state refs live here: `claude plugin validate` reads each `$.state` call
// against a const of this same file. Change a shape tag when the stored fields
// change: an older value is then read as the initial one.
const run = atom({ plugin: 'blast-radius', key: 'run' } as const, EMPTY_RUN, { shape: 'run-1' })
const seen = atom({ plugin: 'blast-radius', key: 'seen' } as const, {} as BlastSeen, { shape: 'seen-1' })
const view = atom({ plugin: 'blast-radius', key: 'view' } as const, { name: null, file: null } as BlastView, {
  shape: 'view-1',
})
const example = atom({ plugin: 'blast-radius', key: 'isExample' } as const, false)
type Kind = 'opened' | 'changed'
const NO_FOUND: Found = { targets: [], problem: '' }
const MAX_SEEN = 800

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Writes in the pieces of an edit's input that the mod needs, whatever the tool. */
function editParts(tool: string, input: Record<string, unknown>): EditPart[] {
  if (tool === 'Edit') return [{ old: text(input.old_string), new: text(input.new_string) }]
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.map((x: unknown) => {
      const o = (x ?? {}) as Record<string, unknown>

      return { old: text(o.old_string), new: text(o.new_string) }
    })
  }

  return []
}

async function mark($: EngineInterface, file: string, kind: Kind): Promise<void> {
  const key = keyOf(file)
  await update($, seen, s => {
    const keys = Object.keys(s)
    const base = keys.length > MAX_SEEN ? Object.fromEntries(keys.slice(-MAX_SEEN / 2).map(k => [k, s[k]!])) : s

    const next: BlastSeen = { ...base }
    next[key] = kind === 'changed' || base[key] === 'changed' ? 'changed' : 'opened'

    return next
  })
}

/** The file as it is before the edit, or '' for a new, huge or unreadable file. */
async function before($: EngineInterface, file: string): Promise<string> {
  try {
    const t = await $.fs.read(file)

    return typeof t === 'string' && t.length < 1_500_000 ? t : ''
  } catch {
    return ''
  }
}

/** Works out the changed names and looks up their uses. Never throws. */
async function lookUp($: EngineInterface, tool: string, input: Record<string, unknown>, file: string, was: string): Promise<Found> {
  try {
    const names =
      tool === 'Write'
        ? namesChangedByWrite(file, was, text(input.content))
        : namesChangedByEdit(file, was, editParts(tool, input))

    return names.length > 0 ? await findUses($, file, names) : NO_FOUND
  } catch {
    return { targets: [], problem: 'The search for uses did not finish.' }
  }
}

/** The person's answer to the end-of-turn question. Runs once per run. */
async function choose($: EngineInterface, choice: 'check' | 'skip'): Promise<void> {
  const r = await read($, run)
  if (r.choice !== 'none') return
  const never = neverOpened(r, await read($, seen))
  await update($, run, x => ({ ...x, choice, isFollowUp: choice === 'check' && never.length > 0 }))
  if (choice === 'check' && never.length > 0) {
    // Not awaited: the prompt starts a turn of its own once the session is idle.
    void Promise.resolve($.prompt.submit({ text: checkPrompt(never) })).catch(() => undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'blast-radius',
      description: 'Show where the function Claude changed is used, and which of those files Claude opened',
    })

    return next(e)
  })

  on('command.run', { command: 'blast-radius' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Blast radius' })

    return { text: 'Blast radius pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    try {
      if (e.agentId === undefined) {
        // Real work has started: the example makes way for it.
        if (await read($, example)) await update($, example, () => false)
        const r = await read($, run)
        if (r.isFollowUp) {
          // The turn the person asked for, to check the files: keep the run.
          await update($, run, x => ({ ...x, isFollowUp: false }))
        } else {
          await update($, run, () => EMPTY_RUN)
          await update($, seen, () => ({}))
          await update($, view, () => ({ name: null, file: null }))
        }
      }
    } catch {
      // The mod's own bookkeeping must never stop a turn.
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    try {
      if (e.agentId === undefined && e.reason === 'answer') {
        await update($, run, x => (x.targets.length > 0 ? { ...x, isEnded: true } : x))
      }
    } catch {
      // Same: never fail the turn.
    }

    return out
  })

  // Reads and edits: one hook, told apart by tool name. If the mod fails after
  // the tool ran, the catch handler hands back the tool's own result.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const file = text(input.file_path)
    const isEdit = tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit'
    if (!file || (tool !== 'Read' && !isEdit)) return next(e)

    if (tool === 'Read') {
      const ran = await next(e)
      if (ran.deny === undefined && !ran.isError) await mark($, file, 'opened').catch(() => undefined)

      return ran
    }

    // The file as it is now, read before the tool changes it; the search then
    // runs beside the edit, so the edit does not wait for it.
    const was = isCodeFile(file) ? await before($, file) : ''
    const search = lookUp($, tool, input, file, was)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    try {
      await mark($, file, 'changed')
      const found = await search
      const now = await read($, run)
      const fresh = found.targets.filter(t => !now.targets.some(o => o.name === t.name && o.defFile === t.defFile && o.root === t.root))
      if (found.targets.length > 0 || found.problem) {
        await update($, run, x => ({
          ...x,
          targets: [
            ...x.targets.filter(o => !found.targets.some(t => t.name === o.name && t.defFile === o.defFile && t.root === o.root)),
            ...found.targets,
          ],
          problem: found.targets.length > 0 ? '' : found.problem,
        }))
      }
      if (fresh.length > 0) return { ...ran, context: [...(ran.context ?? []), noteForAll(fresh)] }
    } catch {
      // No note: the edit itself already went through.
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The one question at the end of the turn, in the band above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const r = await read($, run)
      if (!r.isEnded || r.choice !== 'none') return next(e)
      const never = neverOpened(r, await read($, seen))
      if (never.length === 0) return next(e)
      const { Box, Button, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column" borderStyle="round" borderColor="#ff7a59" paddingX={2} paddingY={1}>
          <Text bold color="#ff7a59">
            Blast Radius
          </Text>
          <Text>{questionFor(r, never)}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="check" variant="primary" onPress={() => choose($, 'check')}>
              Have Claude check them
            </Button>
            <Button key="skip" onPress={() => choose($, 'skip')}>
              Skip
            </Button>
          </Box>
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const isExample = await read($, example)
    const r = isExample ? SAMPLE_RUN : await read($, run)
    const s = isExample ? SAMPLE_SEEN : await read($, seen)
    const v = isExample ? { name: null, file: null } : await read($, view)
    const target = r.targets.find(t => t.name === v.name) ?? r.targets[r.targets.length - 1]
    const rows = target ? rowsFor([target], s) : []
    const c = countStates(rows)
    const never = neverOpened(r, s)
    const places = rows.reduce((n, x) => n + x.count, 0)
    const picked = rows.find(x => x.file === v.file)
    const headline = target
      ? `${target.name} is used in ${plural(places, 'place')} in ${plural(rows.length, 'file')}`
      : 'Nothing to show yet'
    const opened = c.changed + c.opened
    const progress = `${opened} of ${rows.length} files that use it ${r.isEnded ? 'were' : 'are'} opened`
    const verdict = !r.isEnded
      ? 'Claude is still working.'
      : r.choice === 'check'
        ? never.length === 0 ? 'Claude checked the files.' : 'Asked Claude to check them.'
        : r.choice === 'skip'
          ? `Skipped. ${plural(never.length, 'file')} that use${never.length === 1 ? 's' : ''} it ${never.length === 1 ? 'was' : 'were'} not opened.`
          : never.length === 0
            ? 'All files that use it were opened. Nothing to ask.'
            : questionFor(r, never)
    const idle = 'When Claude changes a function, this shows every place it is used and which of those files Claude opened.'
    const first = r.isEnded ? 'Never opened' : 'Not opened yet'

    // The terminal, the editor and the phone: plain text.
    if (e.surface === 'terminal') {
      const { Box, Text, Progress } = $.ui.resolve(e)
      const room = Math.max(3, (e.viewport?.rows ?? 20) - 8)

      return (
        <Box flexDirection="column">
          <Text bold>{headline}</Text>
          {!target && <Text dimColor>{idle}</Text>}
          {!target && r.problem !== '' && <Text dimColor>{r.problem}</Text>}
          {target && <Progress label={progress} value={rows.length === 0 ? 0 : opened / rows.length} />}
          {target && (
            <Text>
              {c.changed} changed, {c.opened} opened, {c.never} {r.isEnded ? 'never opened' : 'not opened yet'}
            </Text>
          )}
          {rows.slice(0, room).map(x => (
            <Text dimColor={x.state !== 'never'}>
              {x.file}: {plural(x.count, 'place')}, {stateWords(x.state, r.isEnded)}
            </Text>
          ))}
          {rows.length > room && <Text dimColor>and {plural(rows.length - room, 'more file')}</Text>}
          {target && <Text>{verdict}</Text>}
        </Box>
      )
    }

    return richPane(
      $.ui.resolve(e),
      { run: r, seen: s, view: v, isExample },
      {
        choose: choice => choose($, choice),
        pickName: name => update($, view, () => ({ name, file: null })),
        setExample: isOn => update($, example, () => isOn),
      },
      e.props.bodyColumns,
    )
  })
}
