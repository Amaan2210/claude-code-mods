import { atom, read } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { CrewInfo, CrewRecipe, CrewStage, CrewTask } from '../types'
import { cycleStage, leaveIt, sendBack } from './actions'
import { DEFAULT_RECIPE, EMPTY_TASK, STAGES, STAGE_LABEL, STAGE_WHEN, colorOf, money, nameOf, normalise, totals } from './crew'
import { headline, stripSvg, trackSvg } from './view'

type Api = EngineInterface

const taskA = atom({ plugin: 'crew', key: 'task' } as const, EMPTY_TASK as CrewTask, { shape: 'task-1' })
const recipeA = atom({ plugin: 'crew', key: 'recipe' } as const, DEFAULT_RECIPE as CrewRecipe, { shape: 'recipe-1' })
const infoA = atom({ plugin: 'crew', key: 'info' } as const, { mode: 'shadow', repo: '' } as CrewInfo, { shape: 'info-1' })
type PaneEvent = RenderInput<'Pane'>

const GREY = '#9097ab'
const AMBER = '#f2c58a'
const GREEN = '#7fd6a0'

const modeLine = (mode: 'shadow' | 'on') =>
  mode === 'on' ? 'On: the crew is switching models.' : 'Practice mode: nothing is switched. This shows what the crew would have done.'

export async function drawPane($: Api, e: PaneEvent) {
  const [task, recipeRaw, info] = await Promise.all([read($, taskA), read($, recipeA), read($, infoA)])
  const recipe = normalise(recipeRaw)
  const t = totals(task.steps)
  const head = headline(t)
  const engineUsd = task.usd0 !== null && task.usdNow !== null ? task.usdNow - task.usd0 : null
  const signed = task.signoff.status !== 'none' && task.signoff.status !== 'would'
  const verdict =
    task.signoff.status === 'ok'
      ? 'sign-off: all done'
      : task.signoff.status === 'missing' || task.signoff.status === 'sent' || task.signoff.status === 'left'
        ? `sign-off found ${task.signoff.missing.length} missing`
        : task.signoff.status === 'would'
          ? 'practice mode: sign-off would run here'
          : 'not signed off yet'
  const steps = task.steps.length
  const noUsage = t.unknown > 0 ? `${t.unknown} step${t.unknown === 1 ? '' : 's'} had no usage report and are left out of the cost.` : ''

  if (e.surface !== 'desktop') {
    // A short plain-text version for the terminal (and any surface without drawings).
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold>Crew</Text>
        <Text dimColor>{modeLine(info.mode)}</Text>
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
        <Text dimColor>Plan: {verdict}.</Text>
        {task.signoff.status === 'missing' && (
          <Box flexDirection="column">
            <Text color={AMBER}>Plan step {task.signoff.missing.join(', ')} looks missing.</Text>
            <Button key="back" variant="primary" onPress={() => void sendBack($)}>Send Claude back to it</Button>
            <Button key="leave" onPress={() => void leaveIt($)}>Leave it</Button>
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

  const { Box, Text, Button, Svg } = $.ui.resolve(e)
  const used = [...new Set(task.steps.map(s => (info.mode === 'on' ? (s.ran ?? s.picked) : s.picked)))]
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text weight="bold">Crew</Text>
        <Text dimColor>{modeLine(info.mode)}</Text>
        {task.phase !== 'idle' && <Text dimColor>Task: {task.title || 'this task'}</Text>}
      </Box>

      <Svg source={trackSvg(task, recipe)} alt={`Stages: plan, build, check, sign-off. Now: ${task.phase}.`} width={400} />

      <Box flexDirection="column">
        <Text dimColor>This task with the crew (estimate)</Text>
        {head ? (
          <Box flexDirection="column">
            <Text weight="bold" color={head.isMore ? '#ffb38a' : GREEN}>
              {head.crew} · {head.diff}
            </Text>
            <Text dimColor>{head.base} if every step ran on {nameOf(recipe.plan.model)}. Hand-offs are counted in.</Text>
          </Box>
        ) : (
          <Text dimColor>Not known yet. The engine has not reported usage for a step.</Text>
        )}
        <Text dimColor>
          Hand-offs between models: {task.hands}
          {t.hand > 0 ? ` · ${money(t.hand)} spent re-reading the chat` : ''}
        </Text>
        {engineUsd !== null && <Text dimColor>The engine's own estimate for this task so far: {money(engineUsd)}</Text>}
        {noUsage !== '' && <Text dimColor>{noUsage}</Text>}
      </Box>

      <Box flexDirection="column">
        <Text dimColor>Every step, by the model that {info.mode === 'on' ? 'ran' : 'would run'} it · {steps} step{steps === 1 ? '' : 's'}</Text>
        {steps > 0 ? (
          <Svg
            source={stripSvg(task.steps, info.mode)}
            alt={`${steps} steps, one bar each, coloured by model. Taller means it cost more.`}
            width={400}
          />
        ) : (
          <Text dimColor>Nothing yet.</Text>
        )}
        <Box gap={2}>
          {used.map(m => (
            <Text color={colorOf(m)}>■ {nameOf(m)}</Text>
          ))}
        </Box>
        <Text dimColor>Dashed outline: the same step all on {nameOf(recipe.plan.model)}. Striped: re-reading the chat after a hand-off.</Text>
      </Box>

      <Box flexDirection="column">
        <Text dimColor>The plan · {verdict}</Text>
        {task.plan.length === 0 && <Text dimColor>{task.signoff.note || 'No plan yet. A plan appears when you approve one.'}</Text>}
        {task.plan.map((p, i) => {
          const isMissing = task.signoff.missing.includes(i + 1)
          const isDone = signed && !isMissing
          return (
            <Text color={isMissing ? AMBER : isDone ? GREEN : undefined}>
              {isMissing ? '○' : isDone ? '✓' : '·'} {i + 1} {p}
              {isMissing ? '  missing' : ''}
            </Text>
          )
        })}
        {task.signoff.note !== '' && task.plan.length > 0 && <Text dimColor>{task.signoff.note}</Text>}
        {task.signoff.status === 'missing' && (
          <Box gap={2}>
            <Button key="back" variant="primary" onPress={() => void sendBack($)}>
              Send Claude back to step {task.signoff.missing[0]}
            </Button>
            <Button key="leave" onPress={() => void leaveIt($)}>
              Leave it
            </Button>
          </Box>
        )}
        {task.signoff.status === 'sent' && <Text color={GREEN}>Sent Claude back to the missing step.</Text>}
        {task.signoff.status === 'left' && <Text dimColor>Left as it is.</Text>}
      </Box>

      <Box flexDirection="column">
        <Text dimColor>Your crew · press a model to change it</Text>
        {STAGES.map((s: CrewStage) => (
          <Box gap={2} alignItems="center">
            <Box width={10}>
              <Text weight="bold">{STAGE_LABEL[s]}</Text>
            </Box>
            <Button key={`stage-${s}`} onPress={() => void cycleStage($, s)}>
              {s === 'look' ? `${nameOf(recipe.look.model)} (same as Build)` : nameOf(recipe[s].model)}
            </Button>
            <Text dimColor>{recipe[s].effort ? `${recipe[s].effort} effort` : 'helper'} · {STAGE_WHEN[s]}</Text>
          </Box>
        ))}
        <Text dimColor>Look up stays on the Build model: switching inside a stage loses the saved chat and costs more. Pressing it changes its effort.</Text>
      </Box>
    </Box>
  )
}
