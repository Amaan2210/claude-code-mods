// A made-up session, shown when the person asks to see an example. Nothing here is from their work.
import type { PitStopFlow, PitStopItem, PitStopOffer, PitStopPoint } from '../types'

const file = (name: string, tokens: number, lastStep: number, editedStep?: number): PitStopItem => ({
  id: `x-file:${name}`,
  kind: 'file',
  label: name,
  tokens,
  addedStep: Math.max(1, lastStep - 2),
  lastStep,
  path: `/shop/${name}`,
  ...(editedStep === undefined ? {} : { editedStep }),
})

const cmd = (id: string, label: string, tokens: number, lastStep: number, key?: string): PitStopItem => ({
  id: `x-cmd:${id}`,
  kind: 'cmd',
  label,
  tokens,
  addedStep: lastStep,
  lastStep,
  ...(key ? { key } : {}),
})

const items: PitStopItem[] = [
  { id: 'x-req', kind: 'request', label: 'Your requests', tokens: 3400, addedStep: 1, lastStep: 20 },
  { id: 'x-notes', kind: 'notes', label: "Claude's notes", tokens: 1900, addedStep: 4, lastStep: 20 },
  { id: 'x-todo', kind: 'todo', label: 'Open items', tokens: 600, addedStep: 9, lastStep: 20 },
  file('src/cart.js', 9100, 17, 17),
  file('src/money.js', 8200, 14, 14),
  file('src/reports/tax.js', 7600, 19, 19),
  cmd('build-2', 'npm run build', 4000, 20, 'npm run build'),
  file('package-lock.json', 26000, 6),
  cmd('build-1', 'npm run build', 14000, 12, 'npm run build'),
  file('src/pages/product.js', 9400, 5),
  cmd('install', 'npm install', 9000, 8),
  file('db/schema.sql', 8300, 7),
  file('src/pages/order.js', 7200, 9),
  cmd('log', 'git log -30 -- src/cart', 6600, 4),
  file('src/coupons.js', 5800, 7),
  file('src/checkout.js', 4900, 10),
]

// The newer run of the build has to be listed after the older one to replace it.
items.sort((a, b) => a.lastStep - b.lastStep)

const flow: PitStopFlow = {
  step: 20,
  isTurnOpen: false,
  gauge: { percent: 81, tokens: 162_000, window: 200_000 },
  todos: [],
  edits: [],
  plan: [],
  seq: 1,
  cleans: 0,
}

const history: PitStopPoint[] = [18, 19, 22, 27, 31, 38, 43, 49, 50, 54, 58, 63, 66, 70, 71, 74, 76, 78, 79, 81].map((percent, i) => ({
  step: i + 1,
  percent,
}))

const offers: PitStopOffer[] = [
  {
    seq: 1,
    kind: 'offer',
    status: 'asking',
    percent: 81,
    freePercent: 44,
    text: 'Memory is 81% full. I can free about 44%: old command output and 6 files Claude is done with. Your requests, decisions and open items all stay.',
  },
]

export const SAMPLE = { items, flow, history, offers }
