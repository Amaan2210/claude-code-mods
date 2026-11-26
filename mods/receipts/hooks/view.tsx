// The pane: a rich drawing on the desktop, a few plain lines on the terminal.
import type { ElementTable, EngineInterface } from 'claude-code'

import type { Claim, ClaimStatus, HelperCheck, Step } from '../types'
import { basename, clip, plural, statusFor } from './check'
import { runClaim, skipClaim } from './actions'
import { readBusy, readClaims, readHelpers, readPicked, readSteps, setPicked } from './state'

type Rich = Pick<ElementTable<'desktop'>, 'Box' | 'Text' | 'Button' | 'Svg' | 'Progress'>
type Plain = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>

const LABEL: Record<ClaimStatus, string> = { ok: 'Proven', none: 'No proof', bad: 'Does not match' }
const SIGN: Record<ClaimStatus, string> = { ok: '✓', none: '?', bad: '≠' }
const HEX: Record<ClaimStatus, string> = { ok: '#6fd696', none: '#f0b35e', bad: '#ff7a6b' }
const NAMED: Record<ClaimStatus, string> = { ok: 'green', none: 'yellow', bad: 'red' }

type Data = {
  claims: Claim[]
  helpers: HelperCheck[]
  steps: Step[]
  picked: string
  isBusy: boolean
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

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const COLOUR: Record<Step['kind'], string> = {
  edit: '#ff6fb1',
  run: '#5fd8ff',
  helper: '#b79cff',
  read: '#8a90a5',
  search: '#8a90a5',
}

/** Every step in order, so what came after what can be seen at a glance. */
const timeline = (steps: Step[], lit: string[], gap: string | undefined, tone: string): string => {
  const list = steps.slice(-40)
  const X0 = 9
  const X1 = 389
  const Y = 23
  const slots = Math.max(list.length, 9)
  const x = (i: number): number => X0 + ((X1 - X0) * i) / (slots - 1)
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="398" height="56" viewBox="0 0 398 56" font-family="system-ui, sans-serif" font-size="10.5">`
  svg += `<line x1="${X0}" y1="${Y}" x2="${X1}" y2="${Y}" stroke="#5b6075" stroke-opacity=".5"/>`
  const gapAt = gap ? list.findIndex(s => s.id === gap) : -1
  if (gapAt >= 0) {
    const a = x(gapAt)
    const b = x(list.length - 1)
    svg += `<rect x="${a}" y="${Y - 9}" width="${Math.max(b - a, 6)}" height="18" rx="4" fill="#f0b35e" fill-opacity=".2" stroke="#f0b35e" stroke-opacity=".5"/>`
    svg += `<text x="${b + 5}" y="${Y - 13}" text-anchor="end" fill="#f0b35e" font-weight="600">nothing checked after this edit</text>`
  }
  list.forEach((s, i) => {
    const cx = x(i)
    const colour = s.kind === 'run' && s.exit ? '#ff7a6b' : COLOUR[s.kind]
    if (lit.includes(s.id)) svg += `<circle cx="${cx}" cy="${Y}" r="9" fill="none" stroke="${tone}" stroke-width="1.5"/>`
    if (s.kind === 'helper') svg += `<path d="M${cx} ${Y - 6} L${cx + 6} ${Y} L${cx} ${Y + 6} L${cx - 6} ${Y}Z" fill="${colour}"/>`
    else svg += `<circle cx="${cx}" cy="${Y}" r="${s.kind === 'read' || s.kind === 'search' ? 3 : 5}" fill="${colour}"/>`
  })
  const key: [Step['kind'], string][] = [['edit', 'changed a file'], ['run', 'ran a command'], ['helper', 'helper'], ['read', 'looked']]
  svg += key
    .map(([k, word], i) => `<circle cx="${X0 + 3 + i * 95}" cy="48" r="3.5" fill="${COLOUR[k]}"/><text x="${X0 + 11 + i * 95}" y="51.5" fill="#9097ab">${esc(word)}</text>`)
    .join('')
  return `${svg}</svg>`
}

export async function readData($: EngineInterface): Promise<Data> {
  return {
  claims: await readClaims($),
  helpers: await readHelpers($),
  steps: await readSteps($),
  picked: await readPicked($),
  isBusy: await readBusy($),
  }
}

function pick($: EngineInterface, key: string): () => Promise<string> {
  return () => setPicked($, key)
}

// ---------- Terminal ----------

export function plain($: EngineInterface, el: Plain, d: Data) {
  const { Box, Text, Button } = el
  const key = defaultKey(d)
  const sel = d.claims.find(c => claimKey(c) === key)
  const canRun = !!sel && !!sel.cmd && sel.status !== 'ok' && !sel.isSkipped
  const last = d.steps.slice(-6)
  return (
    <Box flexDirection="column">
      <Text bold>Receipts: {d.claims.length ? statusFor(d.claims) : 'no answer checked yet'}</Text>
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
      {d.helpers.map(h => (
        <Text color={h.status === 'ok' ? NAMED.ok : NAMED.bad}>
          {h.status === 'ok' ? SIGN.ok : SIGN.bad} Helper report: {h.note ? clip(h.note, 100) : 'matches what changed'}
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

const proofRows = (steps: Step[], ids: string[], rich: Rich) => {
  const { Box, Text } = rich
  return ids.flatMap(id => {
    const s = steps.find(x => x.id === id)
    if (!s) return []
    if (s.kind === 'edit') {
      return [
        <Box key={id} flexDirection="column" borderStyle="round" borderColor="#3a3e55" paddingX={1}>
          <Text mono bold>
            Edited {s.file} (+{s.add ?? 0} -{s.del ?? 0})
          </Text>
          {(s.diff ?? []).slice(0, 4).map((line, i) => (
            <Text mono color={line.startsWith('+') ? '#9be7b3' : '#ffb0a8'}>
              {line}
            </Text>
          ))}
        </Box>,
      ]
    }
    return [
      <Box key={id} flexDirection="column" borderStyle="round" borderColor="#3a3e55" paddingX={1}>
        <Text mono bold color={s.exit ? '#ff7a6b' : undefined}>
          Ran {s.cmd}
          {s.exit === undefined ? '' : `, exit ${s.exit}`}
          {s.by ? ' (run by Receipts)' : ''}
        </Text>
        {(s.out ?? '').split('\n').filter(Boolean).slice(0, 5).map((line, i) => (
          <Text mono dimColor>
            {line}
          </Text>
        ))}
      </Box>,
    ]
  })
}

export function rich($: EngineInterface, el: Rich, d: Data) {
  const { Box, Text, Button, Svg, Progress } = el
  const key = defaultKey(d)
  const claim = d.claims.find(c => claimKey(c) === key)
  const helper = d.helpers.find(h => helperKey(h) === key)
  const ok = d.claims.filter(c => c.status === 'ok').length
  const tone = HEX[claim?.status ?? helper?.status ?? 'ok']
  const lit = claim ? claim.proof : []
  const canRun = !!claim && !!claim.cmd && claim.status !== 'ok' && !claim.isSkipped

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Text bold size="heading">
          Receipts
        </Text>
        <Button
          key="copy"
          label="Copy summary"
          onPress={async () => {
            await $.ui.copy({ text: summary(d), surface: 'desktop' })
            $.ui.toast('Copied the summary')
          }}
        />
      </Box>

      {d.claims.length ? (
        <Progress label={`${ok} of ${plural(d.claims.length, 'claim')} proven`} value={ok / d.claims.length} />
      ) : (
        <Text dimColor>Waiting for an answer from Claude.</Text>
      )}

      <Box flexDirection="column">
        <Text dimColor bold>
          In Claude's answer
        </Text>
        {d.claims.length === 0 && <Text dimColor>Nothing in the last answer could be checked.</Text>}
        {d.claims.map(c => (
          <Button key={claimKey(c)} plain onPress={pick($, claimKey(c))}>
            <Text color={HEX[c.status]} bold={claimKey(c) === key}>
              {SIGN[c.status]}{' '}
            </Text>
            {clip(c.text, 80)} <Text color={HEX[c.status]}>{c.isSkipped ? 'Skipped' : LABEL[c.status]}</Text>
          </Button>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text dimColor bold>
          From helpers
        </Text>
        {d.helpers.length === 0 && <Text dimColor>No helper ran in this session.</Text>}
        {d.helpers.map(h => (
          <Button key={helperKey(h)} plain onPress={pick($, helperKey(h))}>
            <Text color={HEX[h.status === 'ok' ? 'ok' : 'bad']}>{h.status === 'ok' ? SIGN.ok : SIGN.bad} </Text>
            {clip(h.text, 60)}{' '}
            <Text dimColor>
              {h.status === 'ok' ? 'Matches' : `${h.changed.length} changed${h.said === undefined ? '' : ` of ${h.said} said`}`}
            </Text>
          </Button>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text dimColor bold>
          The session, step by step ({plural(d.steps.length, 'step')})
        </Text>
        <Svg
          source={timeline(d.steps, lit, claim?.gap, tone)}
          alt={`Each of the last ${Math.min(d.steps.length, 40)} steps of the session, in order`}
          width={398}
          height={56}
        />
      </Box>

      {claim ? (
        <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tone} padding={1}>
          <Text bold color={tone}>
            {claim.isSkipped ? 'Skipped' : LABEL[claim.status]}
          </Text>
          <Text bold>{'“'}{claim.text}{'”'}</Text>
          <Text>{claim.why}</Text>
          {claim.proof.length ? (
            proofRows(d.steps, claim.proof, el)
          ) : (
            <Text dimColor>No step in this session shows this.</Text>
          )}
          {canRun ? (
            <Box gap={1}>
              <Button key="run" label={`Run ${clip(claim.cmd ?? '', 40)} now`} variant="primary" onPress={() => runClaim($, claim.id)} />
              <Button key="skip" label="Skip" onPress={() => skipClaim($, claim.id)} />
              {d.isBusy ? <Text dimColor>Running</Text> : null}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {helper ? (
        <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tone} padding={1}>
          <Text bold color={tone}>
            Helper report: {helper.status === 'ok' ? 'matches' : 'does not match'}
          </Text>
          <Text bold>{'“'}{helper.text}{'”'}</Text>
          <Text>
            {helper.said === undefined ? 'The report gives no count.' : `The report says ${plural(helper.said, 'file')} changed.`}{' '}
            {plural(helper.changed.length, 'file')} really changed.
          </Text>
          {helper.changed.map(f => (
            <Text mono color={HEX.ok}>
              {SIGN.ok} {f} changed
            </Text>
          ))}
          {helper.missing.map(f => (
            <Text mono color={HEX.bad}>
              X {f} not touched
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
