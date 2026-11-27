import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const FILE = 'D:\\repo\\src\\lib\\money.ts'
const SOURCE = `export function roundPrice(value: number): number {
  const cents = value * 100
  return Math.round(cents) / 100
}

export function unrelated() {
  return 1
}
`
const GREP = [
  'src/cart/totals.ts:41:  const net = roundPrice(line.price)',
  'src/cart/totals.ts:58:  subtotal += roundPrice(net)',
  'src/cart/lineItem.ts:12:  unit: roundPrice(product.price),',
  'src/payments/refund.ts:18:  amount: roundPrice(order.total),',
  'src/lib/money.ts:1:export function roundPrice(value: number): number {',
  'src/cart/notes.ts:3:// roundPrice is explained here',
].join('\n')
const EDIT = {
  tool: 'Edit',
  file_path: FILE,
  old_string: 'return Math.round(cents) / 100',
  new_string: 'return Math.floor(cents)',
} as const

const result = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

/** Stands in for the engine under the plugin. */
function engine(on: On, opts: { grep?: string; fails?: boolean } = {}) {
  const seen = { argv: [] as string[][], prompts: [] as string[] }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: { command: 'blast-radius' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => {
    if (e.path !== FILE) throw new Error('no such file')

    return { value: SOURCE }
  })
  on('process.run', (_, e) => {
    seen.argv.push([...e.argv])
    if (opts.fails) throw new Error('git is not available')

    return e.argv.includes('rev-parse') ? result('D:/repo\n') : result(opts.grep ?? GREP, opts.grep === '' ? 1 : 0)
  })
  on('tool.call', () => ({ result: {}, text: 'done' }))
  on('prompt.submit', (_, e) => {
    seen.prompts.push(e.text)

    return { text: e.text }
  })

  return seen
}

const complete = (turnId: string) =>
  ({ answer: 'ok', durationMs: 5, isAborted: false, turnId, reason: 'answer' }) as const
const BAND = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const
const PANE = {
  title: 'Blast radius',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const band = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'blast-radius', surface, component: 'AbovePrompt', requestId: 'band', props: BAND })
const pane = ($: Engine, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile') =>
  $.ui.mount({ plugin: 'blast-radius', surface, component: 'Pane', requestId: 'blast-radius', props: PANE })

test('an edit gets one note: where the changed function is used', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: 'D:/repo', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix rounding', turnId: 't1' })

  const out = await $.tool.call(EDIT)

  expect(out.deny).toBeUndefined()
  const note = out.context?.join('\n') ?? ''
  // 4 places in 3 files: the definition, the comment and the edited file are left out.
  expect(note).toContain('roundPrice is used in 4 places in 3 files')
  expect(note).toContain('src/cart/totals.ts 2')
  expect(note).toContain('src/payments/refund.ts 1')
  expect(note).not.toContain('money.ts')
  const grep = seen.argv.find(a => a.includes('grep')) ?? []
  expect(grep).toContain('-w')
  expect(grep).toContain('roundPrice')
  expect(grep).not.toContain('unrelated')
})

test('an edit to a file that is not code starts no search and adds no note', async ($, on) => {
  const seen = engine(on)
  const out = await $.tool.call({ ...EDIT, file_path: 'D:\\repo\\notes.txt' })

  expect(out.deny).toBeUndefined()
  expect(out.context).toBeUndefined()
  expect(seen.argv).toHaveLength(0)
})

test('the edit still succeeds when the search fails', async ($, on) => {
  engine(on, { fails: true })
  const out = await $.tool.call(EDIT)

  expect(out.deny).toBeUndefined()
  expect(out.isError).toBeUndefined()
  expect(out.text).toBe('done')
  expect(out.context).toBeUndefined()
})

test('a name nobody else uses gets no note', async ($, on) => {
  engine(on, { grep: '' })
  const out = await $.tool.call(EDIT)

  expect(out.deny).toBeUndefined()
  expect(out.context).toBeUndefined()
})

test('the same name edited twice is noted once', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const first = await $.tool.call(EDIT)
  const second = await $.tool.call(EDIT)

  expect(first.context?.length).toBe(1)
  expect(second.context).toBeUndefined()
})

test('files are tracked as read, changed or never opened, and the question comes only when needed', async ($, on) => {
  const seen = engine(on)
  await $.turn.start({ text: 'fix rounding', turnId: 't1' })
  await $.tool.call(EDIT)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\REPO\\src\\cart\\totals.ts' }) // other case, backslashes
  await $.tool.call({ tool: 'Write', file_path: 'D:/repo/src/cart/lineItem.ts', content: 'x' })
  await $.turn.complete(complete('t1'))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await band($, surface)
    const sentence = await ui.find({ type: 'Text', text: /never opened/ })
    expect(sentence?.text).toBe('roundPrice changed. 1 of the 3 files that use it were never opened: refund.ts.')
    expect(await ui.find({ key: 'check' })).toBeDefined()
    expect(await ui.find({ key: 'skip' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await band($, 'terminal')
  await ui.press({ key: 'check' })
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('src/payments/refund.ts')
  expect(seen.prompts[0]).not.toContain('totals.ts')
  await ui.unmount()
})

test('skip sends nothing, and when every file was opened nothing is asked', async ($, on) => {
  const seen = engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call(EDIT)
  await $.turn.complete(complete('t1'))
  const first = await band($, 'desktop')
  await first.press({ key: 'skip' })
  expect(seen.prompts).toHaveLength(0)
  await first.unmount()

  await $.turn.start({ text: 'again', turnId: 't2' })
  await $.tool.call(EDIT)
  for (const f of ['cart/totals', 'cart/lineItem', 'payments/refund']) {
    await $.tool.call({ tool: 'Read', file_path: `D:/repo/src/${f}.ts` })
  }
  await $.turn.complete(complete('t2'))
  const quiet = await band($, 'terminal')
  expect(await quiet.find({ type: 'Button' })).toBeUndefined()
  await quiet.unmount()
})

test('the question waits until the turn is over, and an aborted turn asks nothing', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call(EDIT)
  const during = await band($, 'terminal')
  expect(await during.find({ type: 'Button' })).toBeUndefined()
  await during.unmount()
  await $.turn.complete({ ...complete('t1'), reason: 'aborted', isAborted: true })
  const after = await band($, 'terminal')
  expect(await after.find({ type: 'Button' })).toBeUndefined()
  await after.unmount()
})

test('the pane draws on every surface', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call(EDIT)
  await $.tool.call({ tool: 'Read', file_path: 'D:/repo/src/cart/totals.ts' })
  await $.turn.complete(complete('t1'))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: /roundPrice is used in 4 places in 3 files/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /never opened/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the desktop pane has the map, and shows the lines of a file not opened yet', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call(EDIT)
  const ui = await pane($, 'desktop')

  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ key: 'file:src/cart/totals.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /const net = roundPrice/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /subtotal/ })).toBeDefined()
  await ui.unmount()
})

test('with nothing changed the pane says so, and the terminal has no map', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: /Nothing to show yet/ })).toBeDefined()
    if (surface === 'terminal') expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    else expect(await ui.find({ key: 'example' })).toBeDefined()
    await ui.unmount()
  }
})

test('the terminal pane is plain text only', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call(EDIT)
  const ui = await pane($, 'terminal')

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /src\/cart\/totals\.ts: 2 places, not opened yet/ })).toBeDefined()
  await ui.unmount()
})

test('the /blast-radius command opens the pane', async ($, on) => {
  const opened: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'blast-radius' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  await $.session.start({ cwd: 'D:/repo', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ command: 'blast-radius', args: '' } as never)

  expect(opened).toEqual(['blast-radius'])
  expect(JSON.stringify(out)).toContain('pane opened')
})
