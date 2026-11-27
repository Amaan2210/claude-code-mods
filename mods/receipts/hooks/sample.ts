// A made-up session, shown when the person asks to see an example. Nothing here is from their work.
import type { Data } from './view'

export const SAMPLE: Data = {
  picked: '',
  isBusy: false,
  hasAnswer: true,
  isExample: true,
  helpers: [],
  steps: [
    { id: 'x1', kind: 'search', start: 1, end: 2, query: 'Math.round' },
    { id: 'x2', kind: 'read', start: 3, end: 4, file: 'src/cart.js' },
    { id: 'x3', kind: 'read', start: 5, end: 6, file: 'src/money.js' },
    { id: 'x4', kind: 'edit', start: 7, end: 8, file: 'src/money.js', add: 24, del: 3, diff: ['- return Math.round(value * 100) / 100', '+ return Math.round(toCents(value)) / 100'] },
    { id: 'x5', kind: 'run', start: 9, end: 10, cmd: 'npm run build', exit: 0, out: 'build: 9 files, 0 errors' },
    { id: 'x6', kind: 'edit', start: 11, end: 12, file: 'src/cart.js', add: 12, del: 7, diff: ['- const total = lines.map(roundPrice).reduce(sum)', '+ const total = roundPrice(lines.reduce(sum))'] },
  ],
  claims: [
    {
      id: 'x-c1',
      raw: { kind: 'edit', text: 'Fixed cart.js: it rounds once, at the end.', what: 'cart.js' },
      text: 'Fixed cart.js: it rounds once, at the end.',
      status: 'ok',
      why: 'cart.js was edited in this turn.',
      proof: ['x6'],
    },
    {
      id: 'x-c2',
      raw: { kind: 'edit', text: 'Added toCents to money.js.', what: 'money.js' },
      text: 'Added toCents to money.js.',
      status: 'ok',
      why: 'money.js was edited in this turn.',
      proof: ['x4'],
    },
    {
      id: 'x-c3',
      raw: { kind: 'command', text: 'The build passes.', what: 'build' },
      text: 'The build passes.',
      status: 'none',
      why: 'The last build ran before the last edit, to cart.js. Nothing has built the code as it is now.',
      proof: ['x5', 'x6'],
      gap: 'x6',
      cmd: 'npm run build',
    },
  ],
}
