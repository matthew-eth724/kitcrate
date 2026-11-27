# Session Handoff

## Current Objective

- Goal: `kitcrate create` author experience — collection name normalization and an interactive skill picker
- Current status: Both implemented and verified. All 13 features complete.
- Branch / commit: main (`fd1a9d7` was the bootstrap base; the create-UX work is uncommitted in the working tree)

## Completed This Session

- [x] Loaded the `poteto-mode` skill and its Feature playbook; wrote the throughput checkpoint in `todo.md`
- [x] Spawned an independent `how` explainer over the create subsystem to check the layering decisions
- [x] Delegated the implementation to a subagent with worktree isolation (feature model: sonnet)
- [x] Recovered the delegate's work: its worktree lost its `.git` link before committing, so the files were copied back into the main checkout and reviewed there
- [x] feat-011 Collection name normalization: `src/core/name.ts`, `normalizeCollectionName` returning a discriminated union
- [x] feat-012 Interactive skill picker: `@clack/prompts` multiselect, space toggles, Enter finalizes, cancellation exits 130
- [x] feat-013 skills CLI discovery reuse: `discoverSkillsInDirectory` built on `resolveSource`; the hand-rolled scan and frontmatter parser are gone
- [x] Fixed the adapter's `isSkillsDiagnostic` guard, which was always false because upstream `isDiagnostic(error)` needs explicit codes
- [x] Fixed the default collection name: `sourceDir.split(sep)` turned `.` into the literal name `"."`
- [x] Added a `gh()` wrapper in `src/git/index.ts` and removed the last `any` from the codebase
- [x] Added `--allow-secrets` to the CLI usage text, which was missing
- [x] Made `create --json` emit machine-readable output, as AGENTS.md requires for every command
- [x] Added a dirty-index guard: the commit takes the whole index, so pre-staged files would have been published
- [x] Warned when a selected skill lives at the source root, because the whole directory is then published
- [x] feat-014 Picker presentation: names only in the list, an empty box that becomes a green tick when ticked
- [x] feat-015 Secrets never block a publish: findings are reported and the publish goes ahead
- [x] Updated AGENTS.md, feature_list.json, progress.md, and this handoff

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Type check | `pnpm typecheck` | pass | strict, no `any` |
| Lint | `pnpm lint` | pass | prettier clean |
| Tests | `pnpm test` | pass | 67/67 across 7 files |
| Build | `pnpm build` | pass | |
| Harness | `validate-harness.mjs` | 100/100 | run after the doc updates |
| Interactive picker | pty harness in `/tmp/pty_drive.py` | pass | typed `My Web Security` -> `my-web-security`; space toggled `beta` off; the commit held only `alpha` and `gamma` |
| Convention error | pty harness | pass | `my_collection` blocked inline with `Unsupported: "_"`; nothing published |
| Dirty index | `create --yes` over a repo with a staged file | pass | exit 1, nothing committed, the author's index left intact |
| Checkbox rendering | pty harness, raw bytes | pass | unticked `ESC[2m` empty box, ticked `ESC[32m` green tick; list scrolls in a 12-row terminal |
| Secrets never block | `create --yes` over a skill holding an AWS key and a GitHub token | pass | exit 0, both findings reported, the file committed; `.env` still excluded from the commit |

## Files Changed

- `src/core/name.ts` (new)
- `src/commands/create.ts`
- `src/skills/index.ts`
- `src/git/index.ts`
- `src/cli.ts`
- `src/commands/pick-skills.ts` (new)
- `tsconfig.test.json` (new, typechecks the test files)
- `test/name.test.ts` (new)
- `test/create.test.ts`
- `package.json`, `pnpm-lock.yaml`
- `AGENTS.md`, `feature_list.json`, `progress.md`, `session-handoff.md`

## Decisions Made

- The normalizer is pure and lives in `core/`, so it is testable without a TTY. It returns a discriminated union rather than throwing.
- Normalization applies only at the author prompt. The `collection.json` schema still rejects invalid names, because the format is a published contract.
- Unsupported characters are refused rather than guessed at, per the request.
- Skill discovery is delegated to the `skills` CLI. kitcrate's own scan and frontmatter parser were deleted, as AGENTS.md requires.
- All prompts moved to `@clack/prompts`. `readline` and clack's multiselect fight over stdin raw mode.
- A skill at the source root is the whole directory, matching how upstream `skills` copies a skill folder. kitcrate warns instead of silently publishing extra files.
- Pre-staged content makes `create` refuse rather than publish. Refusing is the safer default and matches the command's existing fail-loudly posture.
- clack hardcodes its checkbox symbols, so the picker draws itself on top of `@clack/core`'s `MultiSelectPrompt`. Only the rendering is custom; the keyboard handling is still clack's.
- Secret findings never stop a publish. Credential files are still excluded from the commit, which is prevention rather than blocking, and a credential file already in git history now warns instead of blocking. `--allow-secrets` survives as an accepted no-op.

## Blockers / Risks

- None.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- Add integration tests with local bare git repos as fake remotes for the consumer commands (`add`, `install`, `update`, `remove`). The `create` command now has integration coverage; the consumer side does not.
- Consider the "copy skills into the repo" mode for `create`, which AGENTS.md lists in the publish flow but is not built.
