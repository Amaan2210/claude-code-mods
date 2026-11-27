// The pane: a rich drawing on the desktop, a few plain lines on the terminal.
import type { ElementTable, EngineInterface } from 'claude-code'

import type { Claim, ClaimStatus, HelperCheck, Step } from '../types'
import { basename, clip, plural, statusFor } from './check'
import { runClaim, skipClaim } from './actions'
import { TONE, badge, heading, meter, pillSvg, svgDoc, svgLine, svgText, tint, widthOf } from './kit'
import type { Rich } from './kit'
import { SAMPLE } from './sample'
import { readBusy, readClaims, readExample, readHelpers, readMeta, readPicked, readSteps, setExample } from './state'

type Plain = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>

const LABEL: Record<ClaimStatus, string> = { ok: 'Proven', none: 'No proof', bad: 'Does not match' }
const SIGN: Record<ClaimStatus, string> = { ok: '✓', none: '?', bad: '≠' }
const NAMED: Record<ClaimStatus, string> = { ok: 'green', none: 'yellow', bad: 'red' }
const HEX: Record<ClaimStatus, string> = { ok: TONE.ok, none: TONE.warn, bad: TONE.bad }
const GLYPH: Record<ClaimStatus, string> = { ok: '✓', none: '?', bad: '!' }

export type Data = {
  claims: Claim[]
  helpers: HelperCheck[]
  steps: Step[]
  picked: string
  isBusy: boolean
  /** True once an answer of this session was read. */
  hasAnswer: boolean
  /** True while the pane shows the built-in example, not the session. */
  isExample: boolean
}

const claimKey = (c: Claim): string => `c:${c.id}`
const helperKey = (h: HelperCheck): string => `h:${h.agentId}`

const defaultKey = (d: Data): string =>
  d.picked ||
  (d.claims.find(c => c.status !== 'ok') ? claimKey(d.claims.find(c => c.status !== 'ok') as Claim) : '') ||
  (d.helpers.find(h => h.status === 'bad') ? helperKey(d.helpers.find(h => h.status === 'bad') as HelperCheck) : '') ||
  (d.claims[0] ? claimKey(d.claims[0]) : '')

const stepWords = (s: Step): string => {
  if (s.kind === 'edit') return `Edited ${basename(s.file ?? '')}`
  if (s.kind === 'run') return `Ran ${clip(s.cmd ?? '', 60)}${s.exit === undefined ? '' : `, exit ${s.exit}`}`
  if (s.kind === 'read') return `Read ${basename(s.file ?? '')}`
  if (s.kind === 'helper') return `Helper: ${clip(s.query ?? 'a task', 50)}`
  return `Searched ${clip(s.query ?? '', 40)}`
}

const summary = (d: Data): string =>
  [
    `Receipts: ${statusFor(d.claims)}`,
    ...d.claims.map(c => `${SIGN[c.status]} ${c.text} (${LABEL[c.status]}: ${c.why})`),
    ...d.helpers.map(h => `${h.status === 'ok' ? SIGN.ok : SIGN.bad} Helper report: ${h.note ?? 'matches what changed'}`),
  ].join('\n')

const COLOUR: Record<Step['kind'], string> = {
  edit: TONE.pink,
  run: TONE.cyan,
  helper: TONE.pro,
  read: TONE.grey,
  search: TONE.grey,
}

/** Every step in order, so what came after what can be seen at a glance. */
export const timeline = (w: number, steps: Step[], lit: string[], gap: string | undefined, tone: string, hasAnswer: boolean): string => {
  const list = steps.slice(-40)
  const X0 = 9
  const X1 = w - (hasAnswer ? 24 : 9)
  const Y = 32
  const slots = Math.max(list.length, 9)
  const x = (i: number): number => X0 + ((X1 - X0) * i) / (slots - 1)
  let g = svgLine(X0, Y, X1, Y)
  const gapAt = gap ? list.findIndex(s => s.id === gap) : -1
  if (gapAt >= 0) {
    const a = x(gapAt) - 11
    const b = hasAnswer ? X1 + 16 : x(list.length - 1) + 11
    g += `<rect x="${a.toFixed(1)}" y="${Y - 12}" width="${Math.max(b - a, 8).toFixed(1)}" height="24" rx="6" fill="${tint(TONE.warn, 0.16)}" stroke="${tint(TONE.warn, 0.55)}"/>`
    g += svgText(Math.max(b, 190), Y - 18, 'nothing checked after this edit', { fill: TONE.warn, size: 11, weight: 600, anchor: 'end' })
  }
  list.forEach((s, i) => {
    const cx = x(i)
    const colour = s.kind === 'run' && s.exit ? TONE.bad : COLOUR[s.kind]
    if (lit.includes(s.id)) g += `<circle cx="${cx.toFixed(1)}" cy="${Y}" r="9" fill="none" stroke="${tone}" stroke-width="1.5"/>`
    if (s.kind === 'helper') g += `<path d="M${cx} ${Y - 6} L${cx + 6} ${Y} L${cx} ${Y + 6} L${cx - 6} ${Y}Z" fill="${colour}"/>`
    else g += `<circle cx="${cx.toFixed(1)}" cy="${Y}" r="${s.kind === 'read' || s.kind === 'search' ? 3 : 5.5}" fill="${colour}"/>`
  })
  if (hasAnswer) g += `<rect x="${X1 + 9}" y="${Y - 9}" width="3.5" height="18" rx="1.5" class="t" fill="#e6e8f0"/>`
  const key: [string, string][] = [
    [COLOUR.edit, 'changed a file'],
    [COLOUR.run, 'ran a command'],
    [COLOUR.helper, 'helper'],
    [COLOUR.read, 'looked'],
  ]
  let at = X0
  for (const [colour, word] of key) {
    g += `<circle cx="${at + 3}" cy="60" r="3.5" fill="${colour}"/>` + svgText(at + 11, 63.5, word, { size: 10.5 })
    at += 26 + word.length * 5.6
  }
  if (hasAnswer) g += `<rect x="${at}" y="54" width="3" height="12" rx="1.5" class="t" fill="#e6e8f0"/>` + svgText(at + 9, 63.5, 'the answer', { size: 10.5 })
  return svgDoc(w, 70, g)
}

export async function readData($: EngineInterface): Promise<Data> {
  if (await readExample($)) return SAMPLE
  return {
    claims: await readClaims($),
    helpers: await readHelpers($),
    steps: await readSteps($),
    picked: await readPicked($),
    isBusy: await readBusy($),
    hasAnswer: (await readMeta($)).hasAnswer,
    isExample: false,
  }
}

// ---------- Terminal ----------

export function plain($: EngineInterface, el: Plain, d: Data) {
  const { Box, Text, Button } = el
  const key = defaultKey(d)
  const sel = d.claims.find(c => claimKey(c) === key)
  const canRun = !!sel && !!sel.cmd && sel.status !== 'ok' && !sel.isSkipped && !d.isExample
  const last = d.steps.slice(-6)
  return (
    <Box flexDirection="column">
      <Text bold>
        Receipts{d.isExample ? ' (example)' : ''}: {d.claims.length ? statusFor(d.claims) : 'no answer checked yet'}
      </Text>
      {d.claims.map(c => (
        <Text color={NAMED[c.status]}>
          {SIGN[c.status]} {c.isSkipped ? 'Skipped' : LABEL[c.status]}: {clip(c.text, 70)}
        </Text>
      ))}
      {d.claims.filter(c => c.status !== 'ok').map(c => (
        <Text dimColor>
          {'  '}
          {clip(c.why, 110)}
        </Text>
      ))}
      {d.helpers.map(helper => (
        <Text color={helper.status === 'ok' ? NAMED.ok : NAMED.bad}>
          {helper.status === 'ok' ? SIGN.ok : SIGN.bad} Helper report: {helper.note ? clip(helper.note, 100) : 'matches what changed'}
        </Text>
      ))}
      {last.length ? <Text dimColor>Last steps: {last.map(stepWords).join(' / ')}</Text> : <Text dimColor>No steps yet.</Text>}
      {canRun && sel ? (
        <Box gap={1}>
          <Button key="run" label="Run it now" hotkey="r" variant="primary" onPress={() => runClaim($, sel.id)} />
          <Button key="skip" label="Skip" hotkey="s" onPress={() => skipClaim($, sel.id)} />
        </Box>
      ) : null}
    </Box>
  )
}

// ---------- Desktop and the other rich surfaces ----------

/** One step that proves or breaks a claim, with a little of what it showed. */
function proofBox(el: Rich, s: Step) {
  const { Box, Text } = el
  const isEdit = s.kind === 'edit'
  const lines = isEdit ? (s.diff ?? []).slice(0, 4) : (s.out ?? '').split('\n').filter(Boolean).slice(-4)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tint(TONE.grey, 0.35)}>
      <Box gap={1} alignItems="center" paddingX={1} backgroundColor={tint(TONE.grey, 0.12)}>
        <Text size="footnote" dimColor>
          {isEdit ? 'Edited' : s.by ? 'Receipts ran' : 'Ran'}
        </Text>
        <Box flexGrow={1}>
          <Text size="footnote" mono weight="semibold" wrap="truncate-end">
            {isEdit ? (s.file ?? '') : (s.cmd ?? '')}
          </Text>
        </Box>
        {isEdit ? (
          <Text size="footnote" tabular>
            <Text color={TONE.ok}>+{s.add ?? 0}</Text> <Text color={TONE.bad}>-{s.del ?? 0}</Text>
          </Text>
        ) : s.exit === undefined ? null : (
          <Text size="footnote" weight="semibold" color={s.exit ? TONE.bad : TONE.ok}>
            exit {s.exit}
          </Text>
        )}
      </Box>
      {lines.length ? (
        <Box flexDirection="column" paddingX={1}>
          {lines.map(line =>
            isEdit ? (
              <Text size="caption" mono wrap="truncate-end" color={line.startsWith('+') ? TONE.ok : TONE.bad}>
                {line}
              </Text>
            ) : (
              <Text size="caption" mono wrap="truncate-end" dimColor>
                {line}
              </Text>
            ),
          )}
        </Box>
      ) : null}
    </Box>
  )
}

function claimCard($: EngineInterface, el: Rich, d: Data, c: Claim) {
  const { Box, Text, Button } = el
  const tone = HEX[c.status]
  const canRun = !!c.cmd && !c.isSkipped && !d.isExample
  const proof = c.proof.flatMap(id => d.steps.find(s => s.id === id) ?? [])
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tint(tone, 0.6)} backgroundColor={tint(tone, 0.06)} paddingX={2} paddingY={1}>
      <Box flexDirection="column">
        <Text size="caption" weight="bold" color={tone}>
          {(c.isSkipped ? 'Skipped' : LABEL[c.status]).toUpperCase()}
        </Text>
        <Text weight="semibold">
          {'“'}
          {c.text}
          {'”'}
        </Text>
      </Box>
      <Text>{c.why}</Text>
      {proof.length ? proof.map(s => proofBox(el, s)) : <Text dimColor>No step in this session shows this.</Text>}
      {canRun ? (
        <Box gap={1} alignItems="center">
          <Button key="run" label={`Run ${clip(c.cmd ?? '', 36)} now`} variant="primary" onPress={() => runClaim($, c.id)} />
          <Button key="skip" label="Skip" onPress={() => skipClaim($, c.id)} />
          <Text size="footnote" dimColor>
            {d.isBusy ? 'Running…' : 'Receipts runs it and tells Claude the result.'}
          </Text>
        </Box>
      ) : c.cmd && d.isExample ? (
        <Text size="footnote" dimColor>
          In a real session two buttons sit here: Run {c.cmd} now, and Skip.
        </Text>
      ) : null}
    </Box>
  )
}

function helperCard(el: Rich, helper: HelperCheck) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tint(TONE.bad, 0.6)} backgroundColor={tint(TONE.bad, 0.06)} paddingX={2} paddingY={1}>
      <Box flexDirection="column">
        <Text size="caption" weight="bold" color={TONE.bad}>
          A HELPER'S REPORT DOES NOT MATCH
        </Text>
        <Text weight="semibold" maxLines={3}>
          {'“'}
          {helper.text}
          {'”'}
        </Text>
      </Box>
      <Text>
        {helper.said === undefined ? 'The report gives no count.' : `The report says ${plural(helper.said, 'file')} changed.`} {plural(helper.changed.length, 'file')} really
        changed.
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={tint(TONE.grey, 0.35)} paddingX={1}>
        {helper.changed.slice(0, 8).map(f => (
          <Box justifyContent="space-between" gap={1}>
            <Text size="footnote" mono wrap="truncate-end">
              {f}
            </Text>
            <Text size="footnote" color={TONE.ok}>
              changed
            </Text>
          </Box>
        ))}
        {helper.missing.slice(0, 6).map(f => (
          <Box justifyContent="space-between" gap={1}>
            <Text size="footnote" mono wrap="truncate-end">
              {f}
            </Text>
            <Text size="footnote" weight="semibold" color={TONE.bad}>
              not touched
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export function rich($: EngineInterface, el: Rich, d: Data, columns?: number) {
  const { Box, Text, Button, Svg } = el
  const w = widthOf(columns)
  const ok = d.claims.filter(c => c.status === 'ok').length
  const open = d.claims.filter(c => c.status !== 'ok')
  const badHelpers = d.helpers.filter(h => h.status === 'bad')
  const first = open[0]
  const tone = first ? HEX[first.status] : TONE.ok
  const isEmpty = d.claims.length === 0 && d.helpers.length === 0

  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1} alignItems="center">
          <Text size="caption" weight="semibold" dimColor>
            RECEIPTS
          </Text>
          {d.isExample ? <Svg source={pillSvg('Example', TONE.info)} alt="This is an example, not your session" /> : null}
        </Box>
        {d.isExample ? (
          <Button key="clear-example" label="Close the example" onPress={() => setExample($, false)} />
        ) : isEmpty ? null : (
          <Button
            key="copy"
            label="Copy summary"
            onPress={async press => {
              await $.ui.copy({ text: summary(d), surface: press.surface })
              $.ui.toast('Copied the summary')
            }}
          />
        )}
      </Box>

      <Box flexDirection="column">
        <Box gap={1} alignItems="flex-end">
          <Text size="title" weight="bold" tabular>
            {d.claims.length ? statusFor(d.claims) : 'No claims checked yet'}
          </Text>
          {d.claims.length ? <Text dimColor>{open.length ? `${open.length} to look at` : 'nothing to look at'}</Text> : null}
        </Box>
        <Svg
          source={meter(w, d.claims.length ? d.claims.map(c => HEX[c.status]) : ['', '', ''])}
          alt={d.claims.length ? `${ok} of ${plural(d.claims.length, 'claim')} proven` : 'No claims yet'}
        />
      </Box>

      {isEmpty ? (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>
            {d.hasAnswer
              ? 'Nothing in the last answer could be checked. Receipts checks sentences like "the tests pass" or "I changed cart.js".'
              : 'Waiting for an answer from Claude. When Claude says "the tests pass" or "I changed cart.js", each claim shows here with the step that proves it.'}
          </Text>
          <Box>
            <Button key="example" label="See an example" onPress={() => setExample($, true)} />
          </Box>
        </Box>
      ) : null}

      {d.claims.length ? (
        <Box flexDirection="column">
          {heading(el, "In Claude's answer")}
          {d.claims.map(c => {
            const isFirst = c === first
            return (
              <Box
                key={claimKey(c)}
                gap={1}
                alignItems="center"
                paddingX={1}
                borderStyle="round"
                borderColor={isFirst ? tint(HEX[c.status], 0.5) : 'transparent'}
                backgroundColor={isFirst ? tint(HEX[c.status], 0.08) : 'transparent'}
                hover={{ backgroundColor: tint(TONE.grey, 0.14) }}
              >
                <Svg source={badge(GLYPH[c.status], HEX[c.status])} alt={LABEL[c.status]} width={16} height={16} />
                <Box flexGrow={1}>
                  <Text maxLines={2}>{c.text}</Text>
                </Box>
                <Text size="footnote" weight="semibold" color={HEX[c.status]}>
                  {c.isSkipped ? 'Skipped' : LABEL[c.status]}
                </Text>
              </Box>
            )
          })}
        </Box>
      ) : null}

      {isEmpty ? null : (
        <Box flexDirection="column">
          {heading(el, 'From helpers')}
          {d.helpers.length === 0 ? (
            <Box paddingX={1}>
              <Text dimColor>No helper ran in this session.</Text>
            </Box>
          ) : null}
          {d.helpers.map(helper => (
            <Box key={helperKey(helper)} gap={1} alignItems="center" paddingX={1} hover={{ backgroundColor: tint(TONE.grey, 0.14) }}>
              <Svg
                source={badge(helper.status === 'ok' ? '✓' : '!', helper.status === 'ok' ? TONE.ok : TONE.bad)}
                alt={helper.status === 'ok' ? 'Matches' : 'Does not match'}
                width={16}
                height={16}
              />
              <Box flexGrow={1}>
                <Text maxLines={1}>{clip(helper.task || helper.text, 70)}</Text>
              </Box>
              <Text size="footnote" weight="semibold" color={helper.status === 'ok' ? TONE.ok : TONE.bad}>
                {helper.status === 'ok' ? 'Report matches' : `${helper.changed.length} changed${helper.said === undefined ? '' : `, said ${helper.said}`}`}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="column">
        {heading(el, 'The session, step by step', d.steps.length ? plural(d.steps.length, 'step') : 'no steps yet')}
        <Svg
          source={timeline(w, d.steps, first ? first.proof : [], first?.gap, tone, d.hasAnswer || d.claims.length > 0)}
          alt={`Each of the last ${Math.min(d.steps.length, 40)} steps of the session, in order`}
        />
      </Box>

      {open.slice(0, 3).map(c => claimCard($, el, d, c))}
      {badHelpers.slice(0, 2).map(h => helperCard(el, h))}
      {d.claims.length > 0 && open.length === 0 && badHelpers.length === 0 ? (
        <Box gap={1} alignItems="center" borderStyle="round" borderColor={tint(TONE.ok, 0.5)} backgroundColor={tint(TONE.ok, 0.06)} paddingX={2} paddingY={1}>
          <Svg source={badge('✓', TONE.ok)} alt="Proven" width={16} height={16} />
          <Text>Every claim in the last answer has proof. Nothing to do.</Text>
        </Box>
      ) : null}
    </Box>
  )
}
