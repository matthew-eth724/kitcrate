# Session Handoff

## Current Objective

- Goal: `kitcrate add` asks whether to install a collection into the project or the user's home, and every later command follows that choice
- Current status: Implemented and verified. All 16 features complete.
- Branch / commit: main (`4873b67` was the base; the install-scope work is uncommitted in the working tree)

## Completed This Session

- [x] Loaded the `poteto-mode` skill and its Feature playbook; wrote the throughput checkpoint in `todo.md`
- [x] Confirmed upstream `skills` already implements both scopes: `scope: 'global'` installs to `$HOME/.agents/skills`, `scope: 'project'` to `<cwd>/.agents/skills`. Verified by running a real global install against a sandboxed `HOME`.
- [x] Delegated the implementation to a subagent with worktree isolation (feature model: sonnet)
- [x] Recovered the delegate's work: it did not commit, so the files were copied back into the main checkout and reviewed there
- [x] feat-016 Install scope: `src/core/scope.ts` owns the `InstallScope` type, the `project` default, and the scope directory
- [x] `CollectionLockEntrySchema.scope` defaults to `project`, so a lockfile written before this change still loads. An older kitcrate reading a newer lockfile drops the unknown key.
- [x] `add` prompts with clack's `select` on a real TTY, takes `global` from `--global`, and takes `project` under `--yes`, `--json`, or no TTY
- [x] `install`, `update`, and `remove` pass `entry.scope` to the `skills` API; `removeCollectionSkills` takes a scope
- [x] `list` reports each collection's scope, as a line and in `--json`
- [x] Fixed the preexisting check: it counted skills from both scopes, so a global add after a project add marked every member preexisting and installed nothing while reporting success
- [x] Fixed `install.ts` for the same reason: a global collection looked already restored when the skill sat in the project scope
- [x] Fixed three local-source bugs in `src/core/resolve.ts` found while testing: a directory source threw EISDIR, `file://` URLs became a GitHub shorthand URL, and a local path pinned an empty commit the schema rejected
- [x] Fixed the installed-skill counts in `add` and `install`, which counted one entry per agent and so read "Installed 77 skill(s)" for a single skill
- [x] Updated AGENTS.md, feature_list.json, progress.md, and this handoff

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Type check | `pnpm typecheck` | pass | strict, no `any`, both configs |
| Lint | `pnpm lint` | pass | prettier clean |
| Tests | `pnpm test` | pass | 80/80 across 8 files |
| Build | `pnpm build` | pass | |
| Project scope | pty harness in `/tmp/pty_drive.py` | pass | prompt rendered both options; Enter put the skill in `<project>/.agents/skills`, the home directory untouched |
| Global scope | pty harness | pass | Down then Enter put the skill in `$HOME/.agents/skills`, the project directory untouched |
| Scope recorded | lockfile after a global add | pass | `scope: "global"`, and `list` shows it |
| Remove follows the scope | `kitcrate remove --yes` on a global collection | pass | removed from the home, the project left alone |
| Install follows the scope | skill deleted by hand, then `kitcrate install --yes` | pass | restored into the home, the project left alone |
| Counts | `add` output | pass | "Installed 1 skill(s)", not one per agent |

## Files Changed

- `src/core/scope.ts` (new)
- `src/core/lockfile.ts`, `src/core/options.ts`, `src/core/resolve.ts`
- `src/commands/{add,install,update,remove,list}.ts`
- `src/skills/index.ts`
- `src/cli.ts`
- `test/add.test.ts` (new)
- `test/lockfile.test.ts`, `test/create.test.ts`
- `AGENTS.md`, `feature_list.json`, `progress.md`, `session-handoff.md`

## Decisions Made

- The scope is a per-collection field, not a per-lockfile one. `kitcrate-lock.json` stays in the project; a global collection is still recorded in the project that asked for it.
- The prompt is skipped under `--yes`, `--json`, and any non-TTY run, where the scope is `project`. That keeps existing scripts working and matches what `add` did before.
- `--global` lives on the shared `CommandOptions`; only `add` reads it, because the other commands have no scope to choose.
- A skill counts as already present only at the scope the command operates on. The same skill can sit in both scopes at once.
- `file://` is a **git** source, matching upstream: the `skills` package clones those URLs. kitcrate clones them too, because resolving the working tree while installing the clone would compare two different trees.
- The lockfile's `commit` may now be empty, because a local directory that is not a git repository has no commit to pin. `manifestHash` remains the integrity check.
- The scope directory in `src/core/scope.ts` is display-only. The install always goes through the `skills` API, so if upstream moves the path only the hint goes stale.

## Blockers / Risks

- None.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- `update` still has no integration coverage, at either scope. `test/add.test.ts` drives `add`, `install`, and `remove` against a local git repository with a sandboxed `HOME`; `update` is the obvious next gap.
- Consider the "copy skills into the repo" mode for `create`, which AGENTS.md lists in the publish flow but is not built.
