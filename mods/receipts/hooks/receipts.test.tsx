import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The test stands for the engine: each hook here answers what would sit beneath the plugin.

type World = {
  statuses: Array<string | undefined>
  prompts: string[]
  ran: string[][]
  asked: string[]
}

/** Commands the pretend session answers: exit code by command text. */
const world = (on: On, exits: Record<string, number> = {}, model?: string, answer?: string): World => {
  const seen: World = { statuses: [], prompts: [], ran: [], asked: [] }
  on('command.register', () => ({ value: { command: 'receipts' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', (_, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.machine', () => ({ value: { sysname: 'Linux', release: '6', machine: 'x86_64', packageManagers: [], runtimes: [] } }))
  on('process.run', (_, e) => {
    seen.ran.push([...e.argv])
    const code = exits[String(e.argv.at(-1))] ?? 0
    return { value: { exitCode: code, stdout: code ? 'error TS2322: still text' : 'built', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', (_, e) => {
    if (String(e.tool) === 'AskUserQuestion') {
      const question = String((e as unknown as { questions: Array<{ question: string }> }).questions[0]?.question)
      seen.asked.push(question)
      return { result: { questions: [], answers: { [question]: answer ?? 'Skip' } } }
    }
    const cmd = String((e as unknown as { command?: string }).command ?? '')
    const code = exits[cmd] ?? 0
    return code === 0
      ? { result: {}, text: 'ok' }
      : { isError: true as const, result: undefined, text: `Exit code ${code}\nerror TS2322: a price is still read as text` }
  })
  on('turn.start', (_, e) => e)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.report', (_, e) => ({ text: e.text }))
  on('prompt.submit', (_, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('model.complete', () =>
    model === undefined
      ? { value: { isAnswered: false as const, reason: 'api-error' as const, status: 500, error: 'overloaded', usage: {} as never } }
      : { value: { isAnswered: true as const, text: model, usage: {} as never } },
  )
  return seen
}

const finish = ($: Engine, answer: string) =>
  $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

const edit = ($: Engine, file: string, agentId?: string) =>
  $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b', ...(agentId ? { agentId } : {}) })

const spawn = ($: Engine, prompt: string) =>
  $.agent.spawn({
    tool_use_id: 'tu1',
    prompt,
    description: 'update pages',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-sonnet-5-5',
    background: false,
    fork: false,
  })

const build = ($: Engine) => $.tool.call({ tool: 'Bash', command: 'npm run build' })

const MODEL_CLAIMS = [
  'EDIT | totals.ts | Fixed totals.ts so it rounds once.',
  'CMD | build | The build passes.',
].join('\n')
const ANSWER = 'Fixed totals.ts so it rounds once. The build passes.'

test('a claim with proof is proven, and nothing is added under the answer', async ($, on) => {
  const seen = world(on, {}, MODEL_CLAIMS)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await edit($, '/work/src/cart/totals.ts')
  await build($)

  const done = await finish($, ANSWER)

  expect(done.text).toBe(ANSWER)
  expect(seen.statuses.at(-1)).toBe('Receipts: 2 of 2 claims proven')
})

test('a build claim with no build after the last edit gets a line under the answer', async ($, on) => {
  const seen = world(on, {}, MODEL_CLAIMS)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await build($)
  await edit($, '/work/src/cart/totals.ts')

  const done = await finish($, ANSWER)

  expect(done.text).not.toBe(ANSWER)
  expect(done.text).toContain('The build passes.')
  expect(done.text).toContain('ran before the last edit, to totals.ts')
  expect(done.text).not.toContain('Fixed totals.ts')
  expect(seen.statuses.at(-1)).toBe('Receipts: 1 of 2 claims proven')
})

test('a build that failed after the last edit does not match', async ($, on) => {
  world(on, { 'npm run build': 1 }, MODEL_CLAIMS)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await edit($, '/work/src/cart/totals.ts')
  await build($)

  const done = await finish($, ANSWER)

  expect(done.text).toContain('Does not match')
  expect(done.text).toContain('exited with 1')
})

test('when the small model fails, the rules still find the claim', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const done = await finish($, 'All done. The build passes.')

  expect(done.text).toContain('No proof')
  expect(done.text).toContain('No build ran in this session.')
})

test('an answer with nothing checkable is left alone', async ($, on) => {
  const seen = world(on, {}, 'NONE')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const done = await finish($, 'Yes, that fixed the build. It works well now, I think so.')

  expect(done.text).toBe('Yes, that fixed the build. It works well now, I think so.')
  expect(seen.statuses.at(-1)).toBeUndefined()
})

test('a helper report that says 6 files changed when 5 did gets one plain sentence added', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const pages = ['a.tsx', 'b.tsx', 'c.tsx', 'd.tsx', 'e.tsx', 'f.tsx']
  await spawn($, `Update all pages that show a total: ${pages.join(', ')}`)
  for (const page of pages.slice(0, 5)) await edit($, `/work/src/${page}`, 'a1')

  const report = await $.agent.report({
    agentId: 'a1',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    status: 'completed',
    text: 'Done. All 6 pages now call roundPrice.',
  })

  expect(report.text).toContain('Done. All 6 pages now call roundPrice.')
  expect(report.text).toContain('Receipts: The report says 6 files changed. 5 did: f.tsx was not touched.')
})

test('a helper report that matches is passed on as it is', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'm', agentId: 'a2' }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await spawn($, 'Update a.tsx and b.tsx')
  await edit($, '/work/src/a.tsx', 'a2')
  await edit($, '/work/src/b.tsx', 'a2')

  const report = await $.agent.report({
    agentId: 'a2',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    status: 'completed',
    text: 'Updated 2 files: a.tsx and b.tsx.',
  })

  expect(report.text).toBe('Updated 2 files: a.tsx and b.tsx.')
})

test('a helper report that names a file it never touched is flagged', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await edit($, '/work/src/a.tsx', 'a3')

  const report = await $.agent.report({
    agentId: 'a3',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    status: 'completed',
    text: 'I updated a.tsx and b.tsx.',
  })

  expect(report.text).toContain('Receipts: The report says b.tsx changed. It was not touched.')
})

const PANE = {
  plugin: 'receipts',
  component: 'Pane',
  requestId: 'receipts',
  props: {
    title: 'Receipts',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane draws the claims on the terminal and on the desktop', async ($, on) => {
  world(on, {}, MODEL_CLAIMS)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await build($)
  await edit($, '/work/src/cart/totals.ts')
  await finish($, ANSWER)

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /1 of 2 claims proven/ }))?.text).toContain('Receipts')
  expect(await term.find({ type: 'Text', text: /No proof: The build passes/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /Proven: Fixed totals.ts/ })).toBeDefined()
  await term.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /No proof/ })).toBeDefined()
    expect(await ui.find({ key: 'c:c2' })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane says so when nothing has been checked yet', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /no answer checked yet|Waiting for an answer/ })).toBeDefined()
    await ui.unmount()
  }
})

const STALE = 'CMD | build | The build passes.'

test('a stale build claim is offered two choices, and "Run it now" runs the command and settles the claim', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, {}, STALE, 'Run it now')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await build($)
  await edit($, '/work/src/cart/totals.ts')

  const done = await finish($, 'The build passes.')
  expect(done.text).toContain('No proof')
  await clock.advance(300)
  await clock.settle()

  expect(seen.asked[0]).toContain('Run npm run build now?')
  expect(seen.ran).toEqual([['sh', '-c', 'npm run build']])
  expect(seen.statuses.at(-1)).toBe('Receipts: 1 of 1 claim proven')
  expect(seen.prompts).toEqual([])
})

test('when the command the mod runs fails, Claude is told', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, { 'npm run build': 1 }, STALE, 'Run it now')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  // The earlier run passed. The command now fails, as it would after the edit.
  await $.tool.call({ tool: 'Bash', command: 'npm run build' }).catch(() => undefined)
  await edit($, '/work/src/cart/totals.ts')

  await finish($, 'The build passes.')
  await clock.advance(300)
  await clock.settle()

  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('Receipts ran `npm run build`')
  expect(seen.prompts[0]).toContain('exit 1')
  expect(seen.statuses.at(-1)).toBe('Receipts: 0 of 1 claim proven')
})

test('"Skip" runs nothing and leaves the claim without proof', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, {}, STALE, 'Skip')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await build($)
  await edit($, '/work/src/cart/totals.ts')

  await finish($, 'The build passes.')
  await clock.advance(300)
  await clock.settle()

  expect(seen.ran).toEqual([])
  expect(seen.statuses.at(-1)).toBe('Receipts: 0 of 1 claim proven')
})

test('the pane buttons run or skip the claim the person picked', async ($, on) => {
  const seen = world(on, {}, STALE)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await build($)
  await edit($, '/work/src/cart/totals.ts')
  await finish($, 'The build passes.')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'run' })

  expect(seen.ran).toEqual([['sh', '-c', 'npm run build']])
  await ui.unmount()
})
