# Session Handoff

## Current Objective

- Goal: `kitcrate create` publishes successfully into a repository that already has remotes, and a failed publish can be retried
- Current status: Both implemented and verified. All 17 features complete.
- Branch / commit: main (`99c6cd4` is the tip; the working tree is clean)

## Completed This Session

- [x] Every command answers `--help` and `-h` with its own usage, handled in one place in `src/cli.ts` so no command can treat the flag as an argument
- [x] Recorded feat-018: `kitcrate validate` warns on a collection whose skill source is `.`, which is what `kitcrate create` writes

- [x] Fixed the release-tag guard, which stopped a publish when the collection content changed between runs
- [x] feat-017 Publish under a free remote name: `src/core/remote.ts` holds the policy, `listRemotes` and `resolveTagCommit` sit in `src/git/index.ts`, and `create.ts` passes `--remote` to `gh`
- [x] The commit is skipped when the index already matches HEAD, so a failed publish can be retried
- [x] The `v0.1.0` tag is checked instead of discarded: tolerated at HEAD, moved when it points at an earlier kitcrate commit, refused when kitcrate did not make it
- [x] `git init` is checked instead of assumed
- [x] Step comments in create.ts follow AGENTS.md's 11-step flow
- [x] Committed the failing repro first (`8c52566`), then the fix (`e9d350d`), then the docs (`99c6cd4`)

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
| Tests | `pnpm test` | pass | 113/113 across 10 files |
| Help | `kitcrate <command> --help` and `-h` for all seven commands | pass | each prints its own usage and exits 0, and the command itself does not run |
| Build | `pnpm build` | pass | |
| Project scope | pty harness in `/tmp/pty_drive.py` | pass | prompt rendered both options; Enter put the skill in `<project>/.agents/skills`, the home directory untouched |
| Global scope | pty harness | pass | Down then Enter put the skill in `$HOME/.agents/skills`, the project directory untouched |
| Scope recorded | lockfile after a global add | pass | `scope: "global"`, and `list` shows it |
| Remove follows the scope | `kitcrate remove --yes` on a global collection | pass | removed from the home, the project left alone |
| Install follows the scope | skill deleted by hand, then `kitcrate install --yes` | pass | restored into the home, the project left alone |
| Counts | `add` output | pass | "Installed 1 skill(s)", not one per agent |
| Remote conflict | real CLI over a repo with an existing `origin` | pass | published to `github`, `origin` left on its original URL, exit 0 |
| Retry | real CLI, first publish fails then succeeds | pass | exit 0, the collection published from the commit the failed run left |
| Retry with untracked files | real CLI, a README present | pass | exit 0; git's other wording for an empty commit no longer matters |
| No free remote | real CLI with `origin` and `github` taken | pass | refused before the commit, the branch had no commits afterwards |
| Stale tag from kitcrate | real CLI, an earlier create run left `v0.1.0` behind, then the collection changed | pass | the tag moved to the new commit and the publish went through |
| Stale tag not kitcrate's | real CLI with `v0.1.0` on the author's own commit | pass | refused before a remote was added, the tag left where it was |

## Files Changed

- `src/core/remote.ts` (new)
- `src/commands/create.ts`
- `src/git/index.ts`
- `test/remote.test.ts` (new)
- `test/create.test.ts`
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
- `kitcrate create` now adds a second remote when `origin` is taken. The existing remote is left untouched, so a later bare `git push` still goes to `origin`, not to the new collection repository.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- feat-018: `kitcrate validate` on a collection kitcrate created warns "Could not resolve source '.'". The resolver does not accept a bare `.` as a local path the way the `skills` package does, and a skill source has to resolve relative to the collection.json's own directory rather than the working directory. The warning does not fail the check, but it is noise on every collection kitcrate creates.

- `update` still has no integration coverage, at either scope. `test/add.test.ts` drives `add`, `install`, and `remove` against a local git repository with a sandboxed `HOME`; `update` is the obvious next gap.
- Consider the "copy skills into the repo" mode for `create`, which AGENTS.md lists in the publish flow but is not built.
- `create` still only reports credential files that were tracked when the run started. A retry finds them already unstaged, so the "excluded from publish" report comes back empty even though the files are still kept out of the commit.

## feat-019 — the `kitcrate list` rework (done)

The listing shows skills, not collections. One entry per (collection, skill) pair:

    account-activity ~/abc/.agents/skills/account-activity

    Agents: Claude Code, Codex, fx, Gemini CLI, GitHub Copilot +2 more

    Collection: matt711/mywebskills

    Source: acme/webtools

- `src/core/listing.ts` holds the shape and the rendering: `buildListedEntries`, `formatAgents`,
  `abbreviateHome`, `formatEntry`, `styleEntry`, `formatList`, `toJsonList`, `sortedCollections`,
  `scopesToRead`. The plain and the coloured rendering go through one renderer, so they cannot
  drift apart.
- `src/commands/list.ts` is dispatch, the spinner guard, and the I/O.
- `src/skills/index.ts` passes the installed `path` through and maps an agent id to its display
  name through `getSupportedAgents()`.
- The collection's `ref`, `commit`, `manifestHash`, and `only` left the human output and stayed
  in the JSON.
- An installed skill is matched by name **and** scope. Before, a global skill sharing a name
  with a project member lent its path and source to the project collection. That was the double
  listing the user reported.
- The listing reads only the scopes its collections use. The global scope holds a copy of every
  skill for every agent on the machine: 7.9 s against 68 ms for the project scope here.
- The human output is coloured with Node's `styleText` (a no-op off a terminal) and a spinner
  appears only when the wait outlasts 300 ms.

Commits: `fc7aadf` the listing itself, `1772fa0` one renderer and a spinner that waits first,
`6eaa469` read only the scopes the collections use.

Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test` (125 passed, 11 files), `pnpm build`.
Checked on the real artifact in a pty: the format, the colours, the spinner, the `~`
abbreviation, the `+N more` truncation, and a project listing next to a global one.

## feat-020 — a member skill keeps its own source (done)

A manifest entry names where its skill comes from, and may pin a ref for it. Nothing honoured
that: `kitcrate create` wrote `source: '.'` for every skill, `add`/`install`/`update` installed
every member from the collection's own repo, and the skills lock file therefore recorded the
collection as the source of every member. So `kitcrate list` showed the collection's repo where
the skill's own repo belonged.

- `src/core/source.ts` turns a source into its GitHub `owner/repo` form (`owner/repo`,
  `github:owner/repo`, an https or ssh GitHub URL, with or without a trailing `@ref`) and returns
  null for a local path or another host, so nothing guesses a repository. `displaySource` leaves
  an unparseable source as it is.
- `src/core/member-sources.ts` reads the lock file through the `skills` API and names the
  repository each selected skill came from. A copy with no source of its own does not hide the
  source another copy names; two copies naming different repositories do.
- `kitcrate create` writes that `owner/repo` into `collection.json`. A skill it cannot attribute
  records `.`, and the command says which ones and why.
- `src/core/members.ts` groups a manifest's members by source and ref; `.` maps to the
  collection's own source and ref. `src/core/install-members.ts` is the one installer that
  `add`, `install`, and `update` call. `installCollectionSkills` takes a `ref` and passes it
  upstream.
- The collection's own source reaches the installer normalized, without the ref the user wrote
  after it: the `skills` package reads a trailing `@name` as a skill filter, so `owner/repo@v1`
  would look for a skill called `v1`.
- `kitcrate list` shows both `Collection:` and `Source:` as `owner/repo`. The JSON keeps the raw
  source, which mirrors the lock file.
- The delayed spinner moved out of `list.ts` into `src/commands/progress.ts`, next to the other
  terminal helper. `create` uses it for the lock file read, which scans every agent's directory
  (about 7 s on this machine).

Commits: `db8dd7b` the source parser, `f61cddf` the installer honouring the manifest, `c8ce2c2`
create recording the source, `eaa08f7` the listing showing it.

Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test` (153 passed, 14 files), `pnpm build`.
Checked on the real artifact: `kitcrate create` wrote `"source": "acme/webtools"` for a skill
whose lock file entry names that repository, and the listing rendered
`Collection: matt711/mywebskills` and `Source: acme/webtools`, with the JSON keeping both raw.

Open, and worth knowing: the project `skills-lock.json` is version 2 and the global
`~/.agents/.skill-lock.json` is version 3. A fixture written at the wrong version is silently
read as empty, so a source looks "not recorded".
