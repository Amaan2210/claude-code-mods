# Claude Code mods

Four mods for Claude Code. Each one watches a real session and speaks up only when it has something to say.

| Mod | What it does |
| --- | --- |
| **Receipts** | Checks what Claude says it did against what really happened. "The build passes" with no build run gets flagged. |
| **Blast Radius** | When Claude changes a function, tells Claude every place that function is used, and tells you which of those files it never opened. |
| **Crew** | Uses a different model for each stage of a task: the best one plans and signs off, a mid one builds, a small one runs checks. |
| **Pit Stop** | Shows what fills Claude's memory, and holds an automatic clean-up while Claude is in the middle of a multi-file change. |

## Install

You need Claude Code 2.1.332 or newer. Mods are an early-access feature, so a newer release can change how they behave.

In a terminal session, at the prompt:

```
/plugin install receipts --marketplace Amaan2210/claude-code-mods
```

Answer `y` to add the marketplace, then pick a scope. Replace `receipts` with `blast-radius`, `crew` or `pit-stop` for the others.

From a shell:

```
claude plugin install receipts --marketplace Amaan2210/claude-code-mods
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Amaan2210/claude-code-mods`, then **Add plugin**.

Each mod has a pane. Open it with its command: `/receipts`, `/blast-radius`, `/crew` or `/pit-stop`.

A pane is empty until there is something to show. Press **See an example** in it to see a filled one with made-up data.

## Receipts

- Keeps a record of every file read, edit and command in the turn.
- When Claude finishes, finds the claims in its answer and matches each to the record. A "tests pass" claim counts only if the tests ran and passed after the last edit.
- Says nothing when every claim has proof. Otherwise adds one line under the answer and, when it knows the command, offers to run it.
- Checks a helper agent's report against the files the helper really changed.

Cost: one small request to Claude Haiku per answer, which takes about four seconds. It sends the text of Claude's answer.

## Blast Radius

- When Claude edits a function, searches the repo for every use of it and adds a short note to what Claude reads: "roundPrice is used in 14 places in 5 files".
- Tracks which of those files Claude then opened or changed.
- At the end of the turn, if some were never opened, asks once: have Claude check them, or skip.

Limits: the search is a whole-word text search (`git grep`), so a different function with the same name also counts. It needs a git repository. It sees Claude's edit and read tools, not files changed through shell commands. Nothing leaves your machine.

## Crew

| Stage | Default model | When |
| --- | --- | --- |
| Plan | Fable 5.2, high effort | Until you approve the plan |
| Build | Opus 5.5, medium effort | Edits, once the plan is approved |
| Look up | Opus 5.5, low effort | Steps that only search and read |
| Check | Haiku 5.5, as a helper | Lint, build and test commands |
| Sign-off | Fable 5.2, high effort | Once per task, compares the work with the plan |

- **Starts in practice mode.** It changes nothing and only shows which model it would have picked and what that would have cost. To switch models for real, set the mod's option **Crew mode** to `on`: run `/plugin configure crew@claude-code-mods`, or install with `--config mode=on`.
- When it is on, it overrides the model you picked for the session, and it switches only at hand-offs between stages, because a switch makes the next step re-read the whole chat.
- If the same check fails twice, the best model takes one step and hands back.
- Change the crew with `/crew set build sonnet medium`. The crew is saved per repo.

Limits: dollar figures are estimates from list prices built into the mod. A mod cannot force checks onto a helper, so Crew asks Claude to use one. Sign-off is one extra request that sends the plan and the list of changed files.

## Pit Stop

- Lists what fills Claude's memory (files read, command output, your requests) with estimated sizes, sorted into "stays" and "goes". You can move an item.
- At 80% full, when a turn has ended, offers one clean-up and says what would go.
- Holds an automatic clean-up while Claude is in the middle of a multi-file change, then runs it when Claude stops. It never holds past 95% full or for more than 40 steps.

Limits: sizes are estimates. The mod tells the summary what to keep; what survives is still the summarizer's choice.

## Develop

Each mod is a folder under `mods/` with a manifest, a hooks module and tests.

```
claude plugin validate mods/receipts
claude plugin test mods/receipts
claude --plugin-dir mods/receipts
```

## License

MIT
