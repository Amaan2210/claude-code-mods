// The rich pane, for surfaces that can draw pictures.
import type { BlastRun, BlastSeen, BlastView } from '../types'
import { TONE, heading, pillSvg, tint, widthOf } from './kit'
import type { Rich } from './kit'
import { COLORS, barSvg, countStates, mapAlt, mapSvg, stateWords } from './map'
import { neverOpened, plural, questionFor, rowsFor } from './model'

export type PaneData = { run: BlastRun; seen: BlastSeen; view: BlastView; isExample: boolean }

/** What the pane's buttons do. They are handed in, so this file reads no state of its own. */
export type PaneActions = {
  choose: (choice: 'check' | 'skip') => Promise<void>
  pickName: (name: string) => Promise<unknown>
  setExample: (isExample: boolean) => Promise<unknown>
}

export function richPane(el: Rich, d: PaneData, act: PaneActions, columns?: number) {
  const { Box, Text, Button, Svg } = el
  const { run: r, seen: s, view: v, isExample } = d
  const w = widthOf(columns)
  const target = r.targets.find(t => t.name === v.name) ?? r.targets[r.targets.length - 1]
  const rows = target ? rowsFor([target], s) : []
  const c = countStates(rows)
  const never = neverOpened(r, s)
  const places = rows.reduce((n, x) => n + x.count, 0)
  const opened = c.changed + c.opened
  const isAsking = r.isEnded && r.choice === 'none' && never.length > 0
  const status = !target
    ? 'Waiting for a change'
    : !r.isEnded
      ? 'Claude is still working'
      : never.length === 0
        ? 'Every file was opened'
        : r.choice === 'check'
          ? 'Asked Claude to check'
          : r.choice === 'skip'
            ? 'Skipped'
            : `${plural(never.length, 'file')} never opened`
  const tone = !target || !r.isEnded ? TONE.grey : never.length === 0 ? TONE.ok : r.choice === 'none' ? COLORS.never : TONE.grey
  const first = r.isEnded ? 'Never opened' : 'Not opened yet'

  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1} alignItems="center">
          <Text size="caption" weight="semibold" dimColor>
            BLAST RADIUS
          </Text>
          {isExample ? <Svg source={pillSvg('Example', TONE.info)} alt="This is an example, not your session" /> : null}
        </Box>
        {isExample ? (
          <Button key="clear-example" label="Close the example" onPress={() => act.setExample(false)} />
        ) : (
          <Svg source={pillSvg(status, tone)} alt={status} />
        )}
      </Box>

      {target ? (
        <Text size="heading">
          <Text mono weight="bold" color={COLORS.nameText}>
            {target.name}
          </Text>{' '}
          is used in <Text weight="bold">{plural(places, 'place')}</Text> in <Text weight="bold">{plural(rows.length, 'file')}</Text>
        </Text>
      ) : (
        <Box flexDirection="column" gap={1}>
          <Text size="title" weight="bold">
            Nothing to show yet
          </Text>
          <Text dimColor>When Claude changes a function, this shows every place it is used and which of those files Claude opened.</Text>
          {r.problem !== '' ? <Text dimColor>{r.problem}</Text> : null}
          <Box>
            <Button key="example" label="See an example" onPress={() => act.setExample(true)} />
          </Box>
        </Box>
      )}

      {r.targets.length > 1 ? (
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Text size="footnote" dimColor>
            Claude changed:
          </Text>
          {r.targets.map(t => (
            <Button key={`name:${t.name}`} variant={t === target ? 'primary' : 'secondary'} onPress={() => act.pickName(t.name)}>
              {t.name}
            </Button>
          ))}
        </Box>
      ) : null}

      {target ? <Svg source={mapSvg(w, target.name, rows, r.isEnded)} alt={mapAlt(target.name, rows, r.isEnded)} /> : null}

      {target ? (
        <Box flexDirection="column">
          <Box justifyContent="space-between" alignItems="flex-end">
            <Text weight="semibold">
              {opened} of {plural(rows.length, 'file')} that use it {r.isEnded ? 'were' : 'are'} opened
            </Text>
            <Text size="caption" dimColor>
              wider block = more places
            </Text>
          </Box>
          <Svg source={barSvg(w, rows)} alt={`${opened} of ${rows.length} files opened`} />
        </Box>
      ) : null}

      {target ? (
        <Box flexDirection="column" borderStyle="round" borderColor={tint(TONE.grey, 0.35)} backgroundColor={tint(TONE.grey, 0.06)} paddingX={2} paddingY={1}>
          {(
            [
              [COLORS.changed, 'Changed by Claude', c.changed],
              [COLORS.opened, 'Opened, no change needed', c.opened],
              [COLORS.never, first, c.never],
            ] as const
          ).map(([color, label, n]) => (
            <Box gap={1} alignItems="center">
              <Text color={color}>●</Text>
              <Box flexGrow={1}>
                <Text>{label}</Text>
              </Box>
              <Text weight="bold" tabular>
                {n}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {target && isAsking ? (
        <Box flexDirection="column" gap={1} borderStyle="round" borderColor={tint(COLORS.never, 0.6)} backgroundColor={tint(COLORS.never, 0.07)} paddingX={2} paddingY={1}>
          <Text size="caption" weight="bold" color={COLORS.never}>
            NOT CHECKED
          </Text>
          <Text>{questionFor(r, never)}</Text>
          {isExample ? (
            <Text size="footnote" dimColor>
              In a real session two buttons sit here: Have Claude check them, and Skip.
            </Text>
          ) : (
            <Box gap={1}>
              <Button key="pane-check" variant="primary" onPress={() => act.choose('check')}>
                Have Claude check them
              </Button>
              <Button key="pane-skip" onPress={() => act.choose('skip')}>
                Skip
              </Button>
            </Box>
          )}
        </Box>
      ) : null}
      {target && r.isEnded && !isAsking ? (
        <Text dimColor>
          {r.choice === 'check'
            ? never.length === 0
              ? 'Claude checked the files.'
              : 'Asked Claude to check them.'
            : r.choice === 'skip'
              ? `Skipped. ${plural(never.length, 'file')} that use${never.length === 1 ? 's' : ''} it ${never.length === 1 ? 'was' : 'were'} not opened.`
              : 'All files that use it were opened. Nothing to ask.'}
        </Text>
      ) : null}

      {target && rows.length ? (
        <Box flexDirection="column">
          {heading(el, 'Files that use it', 'busiest first')}
          {rows.slice(0, 14).map(x => {
            const lines = x.state === 'never' ? target.uses.filter(u => u.file === x.file).slice(0, 2) : []
            return (
              <Box key={`file:${x.file}`} flexDirection="column" paddingX={1} hover={{ backgroundColor: tint(TONE.grey, 0.12) }}>
                <Box gap={1} alignItems="center">
                  <Text color={COLORS[x.state]}>●</Text>
                  <Box flexGrow={1}>
                    <Text size="footnote" mono weight="semibold" wrap="truncate-end">
                      {x.file}
                    </Text>
                  </Box>
                  <Text size="footnote" dimColor tabular>
                    {plural(x.count, 'place')}
                  </Text>
                  <Box width={13} justifyContent="flex-end">
                    <Text size="footnote" weight="semibold" color={COLORS[x.state]}>
                      {stateWords(x.state, r.isEnded)}
                    </Text>
                  </Box>
                </Box>
                {lines.map(u => (
                  <Box gap={1} paddingLeft={2}>
                    <Text size="caption" mono dimColor tabular>
                      {u.line}
                    </Text>
                    <Text size="caption" mono dimColor wrap="truncate-end">
                      {u.text.trim()}
                    </Text>
                  </Box>
                ))}
              </Box>
            )
          })}
          {rows.length > 14 ? (
            <Text size="footnote" dimColor>
              and {plural(rows.length - 14, 'more file')}
            </Text>
          ) : null}
        </Box>
      ) : null}

      {target ? (
        <Text size="footnote" dimColor>
          Found with a whole-word search of the repo, so another function with the same name also counts.
        </Text>
      ) : null}
    </Box>
  )
}
