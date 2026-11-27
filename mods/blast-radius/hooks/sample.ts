// A made-up change, shown when the person asks to see an example. Nothing here is from their work.
import type { BlastRun, BlastSeen, BlastUse } from '../types'

const ROOT = '/shop'

const uses = (file: string, lines: [number, string][]): BlastUse[] => lines.map(([line, text]) => ({ file, line, text }))

export const SAMPLE_RUN: BlastRun = {
  targets: [
    {
      name: 'roundPrice',
      defFile: 'src/money.js',
      root: ROOT,
      uses: [
        ...uses('src/cart.js', [
          [12, 'const price = roundPrice(item.price * item.qty)'],
          [19, 'return roundPrice(lines.reduce(sum, 0))'],
          [31, 'const discount = roundPrice(total * rate)'],
          [44, 'shipping: roundPrice(weight * perKilo),'],
        ]),
        ...uses('src/pages/summary.js', [
          [8, 'subtotal: roundPrice(cart.subtotal),'],
          [9, 'tax: roundPrice(cart.tax),'],
          [10, 'total: roundPrice(cart.total),'],
        ]),
        ...uses('src/payments/charge.js', [
          [22, 'amount: roundPrice(order.total),'],
          [41, 'const fee = roundPrice(amount * 0.029)'],
        ]),
        ...uses('src/lineItem.js', [
          [6, 'export const lineTotal = item => roundPrice(item.price * item.qty)'],
          [15, 'unit: roundPrice(item.price),'],
        ]),
        ...uses('src/reports/tax.js', [
          [18, 'const due = roundPrice(taxable * rate)'],
          [27, 'rows.push([name, roundPrice(due)])'],
        ]),
        ...uses('src/payments/refund.js', [[14, 'const back = roundPrice(order.total - order.shipping)']]),
      ],
    },
  ],
  isEnded: true,
  choice: 'none',
  isFollowUp: false,
  problem: '',
}

export const SAMPLE_SEEN: BlastSeen = {
  '/shop/src/cart.js': 'changed',
  '/shop/src/pages/summary.js': 'changed',
  '/shop/src/payments/charge.js': 'changed',
  '/shop/src/lineitem.js': 'opened',
}
