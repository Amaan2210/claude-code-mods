import { expect, test } from 'claude-code/testing'

import { namesChangedByEdit, namesChangedByWrite } from './names'

const TS = `import { x } from './x'

export function roundPrice(value: number): number {
  const cents = value * 100
  return Math.round(cents) / 100
}

export const formatPrice = (value: number) => {
  return '$' + roundPrice(value)
}

function hiddenHelper(a: number) {
  return a + 1
}

export class Cart {
  total(lines: number[]) {
    return lines.reduce((a, b) => a + b, 0)
  }
}

export const TAX_RATE = 0.2
`

test('an edit inside a function body names that function', () => {
  const names = namesChangedByEdit('src/money.ts', TS, [
    { old: 'return Math.round(cents) / 100', new: 'return Math.floor(cents)' },
  ])
  expect(names).toEqual(['roundPrice'])
})

test('an edit to a declaration line names it, and an arrow function counts', () => {
  expect(
    namesChangedByEdit('src/money.ts', TS, [
      { old: 'export const formatPrice = (value: number) =>', new: 'export const formatPrice = (value: number, sign: string) =>' },
    ]),
  ).toEqual(['formatPrice'])
})

test('a method names its class member, a private helper is left out', () => {
  expect(
    namesChangedByEdit('src/cart.ts', TS, [{ old: 'lines.reduce((a, b) => a + b, 0)', new: 'lines.length' }]),
  ).toEqual(['total'])
  expect(namesChangedByEdit('src/money.ts', TS, [{ old: 'return a + 1', new: 'return a + 2' }])).toEqual([])
})

test('an edit between functions, or a short or common name, names nothing', () => {
  expect(
    namesChangedByEdit('src/money.ts', TS, [{ old: "import { x } from './x'", new: "import { y } from './y'" }]),
  ).toEqual([])
  expect(
    namesChangedByEdit('src/money.ts', 'export function run() {\n  return 1\n}\n', [{ old: 'return 1', new: 'return 2' }]),
  ).toEqual([])
})

test('an exported constant is a name too', () => {
  expect(namesChangedByEdit('src/money.ts', TS, [{ old: '0.2', new: '0.25' }])).toEqual(['TAX_RATE'])
})

test('a whole-file write names only what was there and changed or went', () => {
  const after =
    TS.replace('Math.round(cents) / 100', 'Math.floor(cents)').replace('export const TAX_RATE = 0.2\n', '') +
    '\nexport function brandNewThing() {}\n'
  expect(namesChangedByWrite('src/money.ts', TS, after).sort()).toEqual(['TAX_RATE', 'roundPrice'])
  expect(namesChangedByWrite('src/new.ts', '', after)).toEqual([])
})

test('python: the function around the edit', () => {
  const py = 'def round_price(value):\n    cents = value * 100\n    return round(cents)\n\n\ndef other_thing():\n    return 1\n'
  expect(namesChangedByEdit('pay.py', py, [{ old: 'return round(cents)', new: 'return int(cents)' }])).toEqual([
    'round_price',
  ])
  expect(namesChangedByEdit('pay.py', py, [{ old: 'return 1', new: 'return 2' }])).toEqual(['other_thing'])
})
