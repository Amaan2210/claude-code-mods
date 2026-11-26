import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Claim, HelperCheck, ReceiptsMeta, Step } from '../types'

// Change a tag when the shape of what is kept changes: a value stored by an
// earlier version under another tag reads as the initial one.
const stepsA = atom({ plugin: 'receipts', key: 'steps' } as const, [], { shape: 'steps-1' })
const claimsA = atom({ plugin: 'receipts', key: 'claims' } as const, [], { shape: 'claims-1' })
const helpersA = atom({ plugin: 'receipts', key: 'helpers' } as const, [], { shape: 'helpers-1' })
const tasksA = atom({ plugin: 'receipts', key: 'tasks' } as const, {}, { shape: 'tasks-1' })
const metaA = atom(
  { plugin: 'receipts', key: 'meta' } as const,
  { cwd: '', turnFrom: 0, hasAnswer: false },
  { shape: 'meta-1' },
)
const pickedA = atom({ plugin: 'receipts', key: 'picked' } as const, '')
const busyA = atom({ plugin: 'receipts', key: 'isBusy' } as const, false)

const MAX_STEPS = 300

let seq = 0
let priming: Promise<void> | undefined

/** The next order number. Steps are compared by it: a command proves a claim only if it began after the last edit ended. */
export async function tick($: EngineInterface): Promise<number> {
  priming ??= read($, stepsA).then(list => {
    seq = Math.max(seq, 0, ...list.map(s => s.end))
  })
  await priming
  seq += 1
  return seq
}

export function addStep($: EngineInterface, step: Step): Promise<Step[]> {
  return update($, stepsA, list => [...list, step].slice(-MAX_STEPS))
}

export function setClaims($: EngineInterface, claims: Claim[]): Promise<Claim[]> {
  return update($, claimsA, () => claims)
}

export function addHelper($: EngineInterface, helper: HelperCheck): Promise<HelperCheck[]> {
  return update($, helpersA, list => [...list.filter(h => h.agentId !== helper.agentId), helper].slice(-20))
}

export function setMeta($: EngineInterface, change: Partial<ReceiptsMeta>): Promise<ReceiptsMeta> {
  return update($, metaA, meta => ({ ...meta, ...change }))
}

// Every read and write of the record is spelled here, beside the references it uses.
export function readSteps($: EngineInterface): Promise<Step[]> {
  return read($, stepsA)
}

export function readClaims($: EngineInterface): Promise<Claim[]> {
  return read($, claimsA)
}

export function readHelpers($: EngineInterface): Promise<HelperCheck[]> {
  return read($, helpersA)
}

export function readTasks($: EngineInterface): Promise<Record<string, string>> {
  return read($, tasksA)
}

export function readMeta($: EngineInterface): Promise<ReceiptsMeta> {
  return read($, metaA)
}

export function readPicked($: EngineInterface): Promise<string> {
  return read($, pickedA)
}

export function readBusy($: EngineInterface): Promise<boolean> {
  return read($, busyA)
}

export function changeClaims($: EngineInterface, change: (list: Claim[]) => Claim[]): Promise<Claim[]> {
  return update($, claimsA, change)
}

export function addTask($: EngineInterface, agentId: string, task: string): Promise<Record<string, string>> {
  return update($, tasksA, tasks => ({ ...tasks, [agentId]: task }))
}

export function setPicked($: EngineInterface, key: string): Promise<string> {
  return update($, pickedA, () => key)
}

export function setBusy($: EngineInterface, isBusy: boolean): Promise<boolean> {
  return update($, busyA, () => isBusy)
}

/** A /clear starts the record over. */
export async function resetRecord($: EngineInterface): Promise<void> {
  await update($, stepsA, () => [])
  await update($, claimsA, () => [])
  await update($, helpersA, () => [])
  await update($, tasksA, () => ({}))
}
