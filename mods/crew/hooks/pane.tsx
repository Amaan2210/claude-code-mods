import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { CrewInfo, CrewRecipe, CrewStage, CrewTask } from '../types'
import { cycleStage, leaveIt, sendBack } from './actions'
import { DEFAULT_RECIPE, EMPTY_TASK, STAGES, STAGE_LABEL, STAGE_WHEN, colorOf, money, nameOf, normalise, totals } from './crew'
import { TONE, badge, heading, pillSvg, tint, widthOf } from './kit'
import type { Rich } from './kit'
import { SAMPLE_RECIPE, SAMPLE_TASK } from './sample'
import { headline, stripSvg, trackSvg } from './view'

type Api = EngineInterface

const taskA = atom({ plugin: 'crew', key: 'task' } as const, EMPTY_TASK as CrewTask, { shape: 'task-1' })
const recipeA = atom({ plugin: 'crew', key: 'recipe' } as const, DEFAULT_RECIPE as CrewRecipe, { shape: 'recipe-1' })
const infoA = atom({ plugin: 'crew', key: 'info' } as const, { mode: 'shadow', repo: '' } as CrewInfo, { shape: 'info-1' })
const exampleA = atom({ plugin: 'crew', key: 'isExample' } as const, false)
type PaneEvent = RenderInput<'Pane'>

export type PaneData = { task: CrewTask; recipe: CrewRecipe; mode: 'shadow' | 'on'; isExample: boolean }

const AMBER = '#f2c58a'

const modeLine = (mode: 'shadow' | 'on') =>
  mode === 'on' ? 'On: the crew is switching models.' : 'Practice mode: nothing is switched. This shows what the crew would have done.'

/** Real work has started: the example makes way for it. */
export async function closeExample($: Api): Promise<void> {
  if (await read($, exampleA)) await update($, exampleA, () => false)
}

const verdictOf = (task: CrewTask): string =>
  task.signoff.status === 'ok'
    ? 'sign-off: all done'
    : task.signoff.status === 'missing' || task.signoff.status === 'sent' || task.signoff.status === 'left'
      ? `sign-off found ${task.signoff.missing.length} missing`
      : task.signoff.status === 'would'
        ? 'practice mode: sign-off would run here'
        : 'not signed off yet'

export async function drawPane($: Api, e: PaneEvent) {
  const [realTask, recipeRaw, info, isExample] = await Promise.all([read($, taskA), read($, recipeA), read($, infoA), read($, exampleA)])
  const task = isExample ? SAMPLE_TASK : realTask
  const recipe = normalise(isExample ? SAMPLE_RECIPE : recipeRaw)
  const mode = isExample ? 'on' : info.mode
  if (e.surface !== 'terminal') return richPane($, $.ui.resolve(e) as Rich, { task, recipe, mode, isExample }, e.props.bodyColumns)

  const t = totals(task.steps)
  const head = headline(t)
  const engineUsd = task.usd0 !== null && task.usdNow !== null ? task.usdNow - task.usd0 : null
  const signed = task.signoff.status !== 'none' && task.signoff.status !== 'would'
  const steps = task.steps.length
  // A short plain-text version for the terminal.
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Text bold>Crew{isExample ? ' (example)' : ''}</Text>
      <Text dimColor>{modeLine(mode)}</Text>
      {task.phase === 'idle' ? <Text>No task yet. It starts with your next message.</Text> : <Text>Task: {task.title || 'this task'}</Text>}
      <Text>
        Steps: {steps}. Hand-offs between models: {task.hands}.
      </Text>
      {head ? (
        <Text>
          With the crew: {head.crew} (estimate). All on {nameOf(recipe.plan.model)}: {head.base}. That is {head.diff}.
        </Text>
      ) : (
        <Text dimColor>Cost: not known yet. The engine has not reported usage for a step.</Text>
      )}
      {engineUsd !== null && <Text dimColor>The engine's own estimate for this task so far: {money(engineUsd)}.</Text>}
      {task.plan.map((p, i) => (
        <Text>
          {task.signoff.missing.includes(i + 1) ? '[ ]' : signed ? '[x]' : '[ ]'} {i + 1} {p}
        </Text>
      ))}
      <Text dimColor>Plan: {verdictOf(task)}.</Text>
      {task.signoff.status === 'missing' && !isExample && (
        <Box flexDirection="column">
          <Text color={AMBER}>Plan step {task.signoff.missing.join(', ')} looks missing.</Text>
          <Button key="back" variant="primary" onPress={() => void sendBack($)}>
            Send Claude back to it
          </Button>
          <Button key="leave" onPress={() => void leaveIt($)}>
            Leave it
          </Button>
        </Box>
      )}
      {STAGES.map(s => (
        <Text>
          {STAGE_LABEL[s]}: {nameOf(recipe[s].model)}
          {recipe[s].effort ? `, ${recipe[s].effort} effort` : ', helper'}
        </Text>
      ))}
      <Text dimColor>Change one: /crew set build sonnet</Text>
    </Box>
  )
}

/** A small card with one figure: a label, the figure, and a quiet line under it. */
function stat(el: Rich, label: string, figure: string, side: string, sideTone: string | undefined, under: string) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" flexGrow={1} width="50%" borderStyle="round" borderColor={tint(TONE.grey, 0.35)} backgroundColor={tint(TONE.grey, 0.06)} paddingX={2} paddingY={1}>
      <Text size="footnote" dimColor>
        {label}
      </Text>
      <Box gap={1} alignItems="flex-end">
        <Text size="title" weight="bold" tabular>
          {figure}
        </Text>
        {side ? (
          sideTone ? (
            <Text weight="semibold" color={sideTone}>
              {side}
            </Text>
          ) : (
            <Text dimColor>{side}</Text>
          )
        ) : null}
      </Box>
      <Text size="footnote" dimColor>
        {under}
      </Text>
    </Box>
  )
}

export function richPane($: Api, el: Rich, d: PaneData, columns?: number) {
  const { Box, Text, Button, Svg } = el
  const { task, recipe, mode, isExample } = d
  const w = widthOf(columns)
  const t = totals(task.steps)
  const head = headline(t)
  const best = recipe.plan.model
  const engineUsd = task.usd0 !== null && task.usdNow !== null ? task.usdNow - task.usd0 : null
  const signed = task.signoff.status !== 'none' && task.signoff.status !== 'would'
  const steps = task.steps.length
  const noUsage = t.unknown > 0 ? `${t.unknown} step${t.unknown === 1 ? '' : 's'} had no usage report and are left out of the cost.` : ''
  const ran = mode === 'on' ? 'ran' : 'would run'
  const byStage = (s: CrewStage) => task.steps.filter(x => x.stage === s)
  const stageCost = (s: CrewStage): string => {
    const list = byStage(s).flatMap(x => (x.crew === null ? [] : [x.crew]))
    return list.length ? money(list.reduce((n, v) => n + v, 0)) : ''
  }
  const latest = task.steps.slice(-5).reverse()

  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1} alignItems="center">
          <Text size="caption" weight="semibold" dimColor>
            CREW
          </Text>
          {isExample ? <Svg source={pillSvg('Example', TONE.info)} alt="This is an example, not your session" /> : null}
        </Box>
        {isExample ? (
          <Button key="clear-example" label="Close the example" onPress={() => update($, exampleA, () => false)} />
        ) : (
          <Svg source={pillSvg(mode === 'on' ? 'On: switching models' : 'Practice mode', mode === 'on' ? TONE.ok : TONE.grey)} alt={modeLine(mode)} />
        )}
      </Box>

      <Box flexDirection="column">
        <Text dimColor>{modeLine(mode)}</Text>
        {task.phase !== 'idle' ? (
          <Text>
            <Text dimColor>Task: </Text>
            <Text weight="semibold">{task.title || 'this task'}</Text>
          </Text>
        ) : null}
      </Box>

      <Svg source={trackSvg(w, task, recipe)} alt={`Stages: plan, build, check, sign-off. Now: ${task.phase}.`} />

      {task.phase === 'idle' && !isExample ? (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>No task yet. It starts with your next message: each step shows here with the model that {ran} it and what it cost.</Text>
          <Box>
            <Button key="example" label="See an example" onPress={() => update($, exampleA, () => true)} />
          </Box>
        </Box>
      ) : null}

      {task.phase !== 'idle' ? (
        <Box gap={1}>
          {stat(
            el,
            'This task with the crew (estimate)',
            head ? head.crew : 'Not known yet',
            head ? head.diff : '',
            head ? (head.isMore ? TONE.bad : TONE.ok) : undefined,
            head ? `${head.base} if all on ${nameOf(best)}` : 'The engine has not reported usage for a step.',
          )}
          {stat(el, 'Hand-offs between models', String(task.hands), '', undefined, t.hand > 0 ? `${money(t.hand)} to re-read the chat` : 'each one re-reads the chat')}
        </Box>
      ) : null}
      {task.phase !== 'idle' && (engineUsd !== null || noUsage !== '') ? (
        <Text size="footnote" dimColor>
          {engineUsd !== null ? `The engine's own estimate for this task so far: ${money(engineUsd)}. ` : ''}
          {noUsage}
        </Text>
      ) : null}

      {steps > 0 ? (
        <Box flexDirection="column">
          {heading(el, `Every step, by the model that ${ran} it`, `${steps} step${steps === 1 ? '' : 's'}`)}
          <Svg source={stripSvg(w, task.steps, mode, best)} alt={`${steps} steps, one bar each, coloured by model. Taller means it cost more.`} />
          <Text size="footnote" dimColor>
            Taller bar: it cost more. Dashed outline: the same step all on {nameOf(best)}. Striped: re-reading the chat after a hand-off.
          </Text>
        </Box>
      ) : null}

      {latest.length ? (
        <Box flexDirection="column">
          {heading(el, 'Latest steps', 'newest first')}
          {latest.map(s => {
            const model = mode === 'on' ? (s.ran ?? s.picked) : s.picked
            return (
              <Box key={`step-${s.n}`} gap={1} alignItems="center" hover={{ backgroundColor: tint(TONE.grey, 0.12) }}>
                <Text color={colorOf(model)}>●</Text>
                <Box flexGrow={1}>
                  <Text wrap="truncate-end">{s.label}</Text>
                </Box>
                <Text size="footnote" weight="semibold" color={colorOf(model)}>
                  {nameOf(model)}
                </Text>
                <Box width={7} justifyContent="flex-end">
                  <Text size="footnote" tabular dimColor>
                    {s.crew === null ? 'no usage' : money(s.crew)}
                  </Text>
                </Box>
              </Box>
            )
          })}
        </Box>
      ) : null}

      <Box flexDirection="column">
        {heading(el, 'The plan', verdictOf(task))}
        {task.plan.length === 0 ? <Text dimColor>{task.signoff.note || 'No plan yet. A plan appears when you approve one.'}</Text> : null}
        {task.plan.map((p, i) => {
          const isMissing = task.signoff.missing.includes(i + 1)
          const isDone = signed && !isMissing
          return (
            <Box key={`plan-${i}`} gap={1} alignItems="center" hover={{ backgroundColor: tint(TONE.grey, 0.12) }}>
              <Svg
                source={badge(isMissing ? '!' : isDone ? '✓' : String(i + 1), isMissing ? TONE.warn : isDone ? TONE.ok : TONE.grey, !isMissing && !isDone)}
                alt={isMissing ? 'Missing' : isDone ? 'Done' : 'Not checked yet'}
                width={16}
                height={16}
              />
              <Box flexGrow={1}>
                <Text maxLines={2}>
                  {i + 1} {p}
                </Text>
              </Box>
              {isMissing ? (
                <Text size="footnote" weight="semibold" color={TONE.warn}>
                  missing
                </Text>
              ) : isDone ? (
                <Text size="footnote" color={TONE.ok}>
                  done
                </Text>
              ) : null}
            </Box>
          )
        })}
      </Box>

      {task.signoff.status === 'missing' ? (
        <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tint(TONE.pro, 0.6)} backgroundColor={tint(TONE.pro, 0.07)} paddingX={2} paddingY={1}>
          <Text size="caption" weight="bold" color={TONE.pro}>
            SIGN-OFF: {task.plan.length - task.signoff.missing.length} OF {task.plan.length} PLAN STEPS ARE DONE
          </Text>
          <Text>
            Missing: step {task.signoff.missing.join(', ')}. Claude said the task was done.{task.signoff.note ? ` ${task.signoff.note}` : ''}
          </Text>
          {isExample ? (
            <Text size="footnote" dimColor>
              In a real session two buttons sit here: Send Claude back to the step, and Leave it.
            </Text>
          ) : (
            <Box gap={1}>
              <Button key="back" variant="primary" onPress={() => void sendBack($)}>
                Send Claude back to step {task.signoff.missing[0]}
              </Button>
              <Button key="leave" onPress={() => void leaveIt($)}>
                Leave it
              </Button>
            </Box>
          )}
        </Box>
      ) : null}
      {task.signoff.status !== 'missing' && task.signoff.note !== '' && task.plan.length > 0 ? <Text dimColor>{task.signoff.note}</Text> : null}
      {task.signoff.status === 'sent' ? <Text color={TONE.ok}>Sent Claude back to the missing step.</Text> : null}
      {task.signoff.status === 'left' ? <Text dimColor>Left as it is.</Text> : null}

      <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tint(TONE.grey, 0.35)} backgroundColor={tint(TONE.grey, 0.06)} paddingX={2} paddingY={1}>
        {heading(el, 'Your crew', isExample ? '' : 'press a model to change it')}
        <Box flexDirection="column">
          {STAGES.map((s: CrewStage) => {
            const model = recipe[s].model
            return (
              <Box key={`row-${s}`} gap={1} alignItems="center">
                <Box width={9}>
                  <Text weight="semibold">{STAGE_LABEL[s]}</Text>
                </Box>
                {isExample ? (
                  <Box width={13}>
                    <Text weight="semibold" color={colorOf(model)}>
                      {nameOf(model)}
                    </Text>
                  </Box>
                ) : (
                  <Button key={`stage-${s}`} onPress={() => void cycleStage($, s)}>
                    <Text color={colorOf(model)}>● </Text>
                    {nameOf(model)}
                  </Button>
                )}
                <Box flexGrow={1} flexDirection="column">
                  <Text size="footnote">{recipe[s].effort ? `${recipe[s].effort} effort` : 'helper'}</Text>
                  <Text size="caption" dimColor>
                    {s === 'look' ? 'same model as Build · ' : ''}
                    {STAGE_WHEN[s]}
                  </Text>
                </Box>
                <Text size="footnote" weight="semibold" tabular>
                  {stageCost(s)}
                </Text>
              </Box>
            )
          })}
        </Box>
        <Text size="caption" dimColor>
          Look up stays on the Build model: switching inside a stage makes the next step re-read the whole chat. Pressing it changes its effort. Dollar figures
          are estimates from list prices.
        </Text>
      </Box>
    </Box>
  )
}
