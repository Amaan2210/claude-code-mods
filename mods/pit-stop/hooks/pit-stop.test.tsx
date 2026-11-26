import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const PANE = {
  plugin: 'pit-stop',
  component: 'Pane',
  requestId: 'pit-stop',
  props: {
    title: 'Pit Stop',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const OFFER = (n: number) =>
  ({
    plugin: 'pit-stop',
    component: 'Placed',
    requestId: `offer-${n}`,
    props: { id: `offer-${n}`, plugin: 'pit-stop' },
  }) as const

const MSGS = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

type Seen = { placed: string[]; compacts: { trigger: string; instructions?: string }[] }

/** Stand in for the engine beneath the plugin and start the session. */
async function boot($: Engine, on: On): Promise<Seen> {
  const seen: Seen = { placed: [], compacts: [] }
  let text = ''
  on('command.register', () => ({ value: { command: 'pit-stop' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.place', (_, e) => {
    seen.placed.push(e.id)
    return { value: { isPlaced: true, requestId: e.id } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.messages', () => ({ value: MSGS }) as never)
  on('session.end', () => ({ sessionId: 's1' }) as never)
  on('session.compact', (_, e) => {
    seen.compacts.push({ trigger: e.trigger, instructions: e.instructions })
    return { messages: MSGS, tokensBefore: 170_000, tokensAfter: 40_000 }
  })
  // Each tool call below sets how long its output is.
  ;(globalThis as { setOutput?: (n: number) => void }).setOutput = n => {
    text = 'x'.repeat(n)
  }
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return seen
}

const setOutput = (n: number) => (globalThis as unknown as { setOutput: (n: number) => void }).setOutput(n)

const read = async ($: Engine, file: string, chars = 8000) => {
  setOutput(chars)
  await $.tool.call({ tool: 'Read', file_path: file })
}
const bash = async ($: Engine, command: string, chars = 400) => {
  setOutput(chars)
  await $.tool.call({ tool: 'Bash', command })
}
const edit = async ($: Engine, file: string) => {
  setOutput(200)
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' })
}
const todos = async ($: Engine, list: [string, 'pending' | 'in_progress' | 'completed'][]) => {
  setOutput(100)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: list.map(([content, status]) => ({ content, status, activeForm: content })),
  })
}
const measure = ($: Engine, percent: number) =>
  $.session.measure({
    context: { window: 200_000, tokens: percent * 2000, percent },
    rateLimits: [],
    changed: ['context'],
  })
const endTurn = ($: Engine) =>
  $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
const prompt = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid,
  })

/** Old file and command output, then enough small steps that they are idle. */
async function ageItems($: Engine) {
  await prompt($, 'u1', 'fix the cart total')
  await read($, '/p/old.ts')
  await bash($, 'npm run build', 8000)
  for (let i = 0; i < 8; i += 1) await bash($, `echo step ${i}`, 40)
  await read($, '/p/now.ts', 800)
}

test('items are recorded and sorted into stays and goes, with a reason', async ($, on) => {
  await boot($, on)
  await ageItems($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /old\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /not touched for \d+ steps/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /old output, not used for/ })).toBeDefined()
    // The file read on the last step is in use, so it is on the stays side.
    expect(await ui.find({ type: 'Text', text: /in use right now/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a newer run of the same command replaces the older one', async ($, on) => {
  await boot($, on)
  await bash($, 'npm run build', 4000)
  await bash($, 'npm run build', 4000)
  await bash($, 'ls', 100)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /a newer run replaced it/ })).toBeDefined()
  await ui.unmount()
})

test('the offer is made only past the threshold, at a good moment, once', async ($, on) => {
  const seen = await boot($, on)
  await ageItems($)

  await measure($, 70)
  await endTurn($)
  expect(seen.placed).toEqual([]) // below the threshold

  await measure($, 85)
  await endTurn($)
  expect(seen.placed).toEqual(['offer-1'])

  await endTurn($)
  expect(seen.placed).toEqual(['offer-1']) // still waiting for an answer: not asked twice

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...OFFER(1), surface })
    const line = await ui.find({ type: 'Text', text: /Memory is 85% full/ })
    expect(line?.text).toMatch(/free about \d+% \(estimate\)/)
    expect(line?.text).toMatch(/requests, decisions and open items all stay/)
    expect(await ui.find({ type: 'Button', key: 'now-1' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'later-1' })).toBeDefined()
    await ui.unmount()
  }
})

test('no offer while Claude is in the middle of a multi-file change', async ($, on) => {
  const seen = await boot($, on)
  await ageItems($)
  await todos($, [
    ['change a.ts', 'completed'],
    ['change b.ts', 'in_progress'],
  ])
  await measure($, 88)
  await endTurn($)
  expect(seen.placed).toEqual([])
})

test('the edit-burst signal: edits in several files with more files named holds an automatic clean-up', async ($, on) => {
  const seen = await boot($, on)
  await prompt($, 'u1', 'say Cart in a.tsx, b.tsx, c.tsx and d.tsx')
  await edit($, '/p/a.tsx')
  await edit($, '/p/b.tsx')
  await measure($, 90)
  const held = await $.session.compact({ trigger: 'auto', messages: MSGS })
  expect(held.skip).toMatch(/held the clean-up/)
  expect(seen.compacts).toEqual([])

  // The whole plan is done: nothing is held any more.
  await edit($, '/p/c.tsx')
  await edit($, '/p/d.tsx')
  const out = await $.session.compact({ trigger: 'auto', messages: MSGS })
  expect(out.skip).toBeUndefined()
  expect(seen.compacts.length).toBe(1)
})

test('three files changed in the last few steps hold a clean-up, with no list and no names', async ($, on) => {
  const seen = await boot($, on)
  await prompt($, 'u1', 'add a comment to every file')
  await edit($, '/p/a.ts')
  await edit($, '/p/b.ts')
  await measure($, 90)
  const two = await $.session.compact({ trigger: 'auto', messages: MSGS })
  expect(two.skip).toBeUndefined() // two files and nothing named: not enough to hold

  await edit($, '/p/c.ts')
  await edit($, '/p/d.ts')
  await edit($, '/p/e.ts')
  await measure($, 90)
  const held = await $.session.compact({ trigger: 'auto', messages: MSGS })
  expect(held.skip).toMatch(/it changed 3 files|it changed 5 files/)
  expect(seen.compacts.length).toBe(1)
})

test('an automatic clean-up is held mid-change and runs when Claude stops', async ($, on) => {
  const seen = await boot($, on)
  await ageItems($)
  await todos($, [
    ['change a.ts', 'completed'],
    ['change b.ts', 'in_progress'],
    ['change c.ts', 'pending'],
  ])
  await measure($, 90)

  const held = await $.session.compact({ trigger: 'auto', messages: MSGS })
  expect(held.skip).toMatch(/middle of a change/)
  expect(seen.compacts).toEqual([]) // the engine's own clean-up never ran

  // The pane says so, with the point it was held at.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Clean-up held/ })).toBeDefined()
  await ui.unmount()
  expect(seen.placed).toEqual(['offer-1'])

  // Still mid-change on the next step: the engine tries again and is held again, with one notice.
  const again = await $.session.compact({ trigger: 'auto', messages: MSGS })
  expect(again.skip).toMatch(/middle of a change/)
  expect(seen.compacts).toEqual([])
  expect(seen.placed).toEqual(['offer-1'])

  // Claude stops: nothing is half-written, so the held clean-up runs, even with to-dos left.
  await endTurn($)
  expect(seen.compacts.length).toBe(1)
  expect(seen.compacts[0]?.trigger).not.toBe('auto') // a plugin's own call is never held
  expect(seen.placed).toEqual(['offer-1', 'offer-2'])

  const done = await $.ui.mount({ ...OFFER(2), surface: 'terminal' })
  expect(await done.find({ type: 'Text', text: /reached a stopping point, so I cleaned up/ })).toBeDefined()
  await done.unmount()
})

test('the hard limit always lets a clean-up through, mid-change or not', async ($, on) => {
  const seen = await boot($, on)
  await todos($, [['change b.ts', 'in_progress']])
  await measure($, 96)
  const out = await $.session.compact({ trigger: 'auto', messages: MSGS })
  expect(out.skip).toBeUndefined()
  expect(seen.compacts.length).toBe(1)

  // The person's own /compact and a plugin's are never held either.
  await measure($, 82)
  await $.session.compact({ trigger: 'manual', messages: MSGS })
  expect(seen.compacts.length).toBe(2)
})

test('the hard limit is a setting', { options: { hardLimit: 85, threshold: 70 } }, async ($, on) => {
  const seen = await boot($, on)
  await todos($, [['change b.ts', 'in_progress']])
  await measure($, 84)
  expect((await $.session.compact({ trigger: 'auto', messages: MSGS })).skip).toBeDefined()
  await measure($, 86)
  expect((await $.session.compact({ trigger: 'auto', messages: MSGS })).skip).toBeUndefined()
  expect(seen.compacts.length).toBe(1)
})

test('a hold never lasts past its step limit', async ($, on) => {
  const seen = await boot($, on)
  await todos($, [['change b.ts', 'in_progress']])
  await measure($, 90)
  expect((await $.session.compact({ trigger: 'auto', messages: MSGS })).skip).toBeDefined()
  for (let i = 0; i < 45; i += 1) await bash($, `echo ${i}`, 40)
  const out = await $.session.compact({ trigger: 'auto', messages: MSGS })
  expect(out.skip).toBeUndefined()
  expect(seen.compacts.length).toBe(1)
})

test('a clean-up is steered by what stays, and what the person moved', async ($, on) => {
  const seen = await boot($, on)
  await ageItems($)
  await todos($, [['finish the refund page', 'completed']])
  await todos($, [['write the tests', 'pending']])
  await $.session.compact({ trigger: 'manual', messages: MSGS, instructions: 'focus on the cart' })
  const text = seen.compacts[0]?.instructions ?? ''
  expect(text).toContain('focus on the cart')
  expect(text).toContain('keep every request the person made')
  expect(text).toContain('fix the cart total')
  expect(text).toContain('write the tests') // the open item
  expect(text).toMatch(/Not needed in full[^\n]*old\.ts/)
  expect(text).not.toMatch(/Not needed in full[^\n]*now\.ts/)
})

test('moving an item to the other group changes its fate and its reason', async ($, on) => {
  const seen = await boot($, on)
  await ageItems($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'move-file:/p/old.ts' })).toBeDefined()
    await ui.press({ key: 'move-file:/p/old.ts' })
    expect(await ui.find({ type: 'Text', text: /moved by you/ })).toBeDefined()
    await ui.press({ key: 'move-file:/p/old.ts' }) // and back again
    expect(await ui.find({ type: 'Text', text: /moved by you/ })).toBeUndefined()
    await ui.unmount()
  }
  const last = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await last.press({ key: 'move-file:/p/old.ts' })
  await last.unmount()
  // old.ts is now kept, so the clean-up names it as still in use.
  await $.session.compact({ trigger: 'manual', messages: MSGS })
  const text = seen.compacts[0]?.instructions ?? ''
  expect(text).toMatch(/Still in use[^\n]*old\.ts/)
})

test('"Not yet" asks again at 90%; "Clean up now" runs the clean-up', async ($, on) => {
  const seen = await boot($, on)
  await ageItems($)
  await measure($, 82)
  await endTurn($)
  expect(seen.placed).toEqual(['offer-1'])

  const ui = await $.ui.mount({ ...OFFER(1), surface: 'desktop' })
  await ui.press({ key: 'later-1' })
  await ui.unmount()

  await endTurn($)
  await measure($, 88)
  await endTurn($)
  expect(seen.placed).toEqual(['offer-1']) // not asked at 88

  await measure($, 91)
  await endTurn($)
  expect(seen.placed).toEqual(['offer-1', 'offer-2'])

  const again = await $.ui.mount({ ...OFFER(2), surface: 'terminal' })
  await again.press({ key: 'now-2' })
  await again.unmount()
  expect(seen.compacts.length).toBe(1)
  expect(seen.compacts[0]?.trigger).not.toBe('auto') // a plugin's own call is never held
  expect(seen.compacts[0]?.instructions).toContain('Pit Stop:')
})

test('after a clean-up what went is gone from the lists', async ($, on) => {
  await boot($, on)
  await ageItems($)
  await $.session.compact({ trigger: 'manual', messages: MSGS })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /old\.ts/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Last clean-up/ })).toBeUndefined() // terminal pane is short
  await ui.unmount()
  const wide = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await wide.find({ type: 'Text', text: /Last clean-up/ }))?.text).toMatch(/measured/)
  await wide.unmount()
})

test('the pane is drawn on terminal (plain text) and desktop (pictures)', async ($, on) => {
  await boot($, on)
  await ageItems($)
  await measure($, 83)

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /memory 83% full/ }))?.text).toContain('Pit Stop')
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Text', text: /Memory 83% full/ })).toBeDefined()
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /sizes are estimates/i })).toBeDefined()
  await desk.unmount()
})

test('what it cannot know is not shown', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /not measured yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Memory \d+% full/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('a /clear starts the lists over', async ($, on) => {
  await boot($, on)
  await ageItems($)
  await $.session.end({ reason: 'clear' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /old\.ts/ })).toBeUndefined()
  await ui.unmount()
})

test('/pit-stop opens the pane', async ($, on) => {
  await boot($, on)
  const out = await $.command.run({
    command: 'pit-stop',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  } as never)
  expect(out.text).toMatch(/Pit Stop is open/)
})
