# Session Progress Log

## Current State

**Last Updated:** 2025-11-26
**Session ID:** implementation-session-5
**Active Feature:** [none - all features complete]

## Status

### What's Done

- [x] Harness setup (feature_list.json, progress.md, init.sh, session-handoff.md)
- [x] AGENTS.md startup & done section added
- [x] feat-001 Project bootstrap: package.json, tsconfig.json, pnpm-workspace.yaml, .prettierrc; pnpm install; skills package resolves
- [x] feat-002 Core modules: manifest.ts, lockfile.ts, resolve.ts, hash.ts, secrets.ts
- [x] feat-003 skills adapter: src/skills/index.ts wrapping resolveSource/installSkills/listSkills/removeSkills
- [x] feat-004 git wrappers: src/git/index.ts (git, resolveRef, showFileAtCommit, cloneRepo)
- [x] feat-005 cli.ts entry: command dispatch with --yes/--json/--debug
- [x] feat-006 add command: resolve collection, detect preexisting, install via skills, write kitcrate-lock.json
- [x] feat-007 list command: reads lockfile, shows collections and skills
- [x] feat-008 install, update, remove commands: restore + manifestHash verify, ref diff, ownership rules
- [x] feat-009 validate, create commands: validate collection.json + skill refs; publish flow with secret scan; skill discovery through the `skills` adapter
- [x] feat-010 Tests and verification: 67 unit and integration tests pass, typecheck clean, lint clean, build clean
- [x] feat-011 Collection name normalization: `src/core/name.ts`, author input parsed into the lowercase-hyphen convention, unsupported characters raise the convention error
- [x] feat-012 Interactive skill picker: `@clack/prompts` multiselect in `create`, space toggles and Enter finalizes, non-interactive runs select every skill
- [x] feat-013 skills CLI discovery reuse: hand-rolled scan and frontmatter parser replaced by `discoverSkillsInDirectory`; broken `isSkillsDiagnostic` guard fixed
- [x] feat-014 Picker presentation: skill list shows names only, every box starts empty, and ticking one turns it into a green tick; the header shows the running count
- [x] feat-015 Secrets never block a publish: findings are reported, credential files stay excluded, the history check warns instead of blocking, and `--allow-secrets` became a no-op

### What's In Progress

- none

### What's Next

- All 13 features complete. Next steps would be integration tests with local bare git repos as fake remotes (the create command now has one; the consumer commands still do not).

## Blockers / Risks

- None currently

## Decisions Made

- The `skills` package is a registry dependency (`^1.9.0`) resolved by pnpm, isolated behind `src/skills/index.ts`. There is no local checkout to build or symlink.
- Node16 module resolution with `.js` extensions in import paths
- All core modules typecheck clean with strict TypeScript
- Name normalization lives in `src/core/name.ts` as a pure function returning a discriminated union, so an invalid name is unrepresentable in the success branch. The `collection.json` schema still rejects invalid names.
- Skill discovery is delegated to the `skills` CLI through `discoverSkillsInDirectory` in `src/skills/index.ts`. kitcrate's hand-rolled scan and frontmatter parser were deleted, as AGENTS.md requires.
- All prompts in `create` moved from `readline` to `@clack/prompts` so one library owns stdin and raw-mode handling; mixing the two breaks the multiselect.
- The `create` commit takes the whole git index, so the command now refuses to publish when the repository already has staged changes rather than silently publishing the author's files.
- `gh` now goes through a `gh()` wrapper in `src/git/index.ts`, matching AGENTS.md's "thin wrappers around git and gh".
- The picker draws itself. clack hardcodes its checkbox symbols, so `src/commands/pick-skills.ts` builds on `@clack/core`'s `MultiSelectPrompt` for the keyboard handling and renders the list with an empty box and a green tick.
- Secret findings never stop a publish. The scan reports what it finds and the publish goes ahead. Only credential files are kept out of the commit, because exclusion prevents them from being published rather than stopping the publish. `--allow-secrets` is still accepted so older scripts keep working, but it does nothing.
- The early whole-tree secret scan was dropped from the publish flow. The tracked-file scan covers exactly the files that would be pushed, so the tree scan only produced duplicate warnings. `scanForSecrets` stays in `core/secrets.ts` as a tested utility.
- `pnpm typecheck` now covers the test files too, via `tsconfig.test.json`. The main `tsconfig.json` excludes `test/` so the build output stays under `dist/`.
- No skill starts ticked. The author picks what goes into the collection; the non-interactive `--yes` and `--json` paths still take every skill, since "no questions asked" means no filtering.

## Files Modified This Session

- `src/core/name.ts` (new)
- `src/commands/create.ts` (clack prompts, picker, adapter discovery, scoped staging, JSON output, dirty-index guard)
- `src/skills/index.ts` (`discoverSkillsInDirectory`, fixed `isSkillsDiagnostic`)
- `src/git/index.ts` (`gh()` wrapper, `listStagedChanges()`)
- `src/cli.ts` (`--allow-secrets` in the usage text)
- `src/commands/pick-skills.ts` (new, custom checkbox rendering)
- `package.json`, `pnpm-lock.yaml` (`@clack/core` dependency)
- `test/name.test.ts` (new, 14 cases)
- `test/create.test.ts` (8 cases: discovery plus the publish flow with a `gh` stub on PATH)
- `package.json`, `pnpm-lock.yaml` (`@clack/prompts` dependency)

## Evidence of Completion

- [x] Tests pass: 67/67 vitest tests pass
- [x] Type check clean: `pnpm typecheck` passes
- [x] Lint clean: `pnpm lint` passes
- [x] Build clean: `pnpm build` passes
- [x] Harness validation: 100/100

## Notes for Next Session

All roadmap step 1-3 features are implemented. Remaining work per AGENTS.md:
- Integration tests with local bare git repos as fake remotes for the consumer commands (`add`, `install`, `update`, `remove`). The `create` command now has integration coverage with a `gh` stub on PATH.
- `create` still only supports references mode (`source: "."`); the "copy skills into the repo" option is not built.
- `create` writes `collection.json` and `.gitignore` before `git init`, so a failed run leaves them on disk with no repository.

## Recent Changes

- Install scope: `kitcrate add` now asks where the collection's skills go, and the answer
  is recorded in `kitcrate-lock.json` as `scope`.
  - New `src/core/scope.ts` owns the `InstallScope` type, the `project` default, and the one
    place that knows the scope directory (`<project>/.agents/skills` or `~/.agents/skills`,
    display only; the install still goes through `skills`).
  - `CollectionLockEntrySchema.scope` is `z.enum(['project', 'global']).default('project')`,
    so a lockfile written before this change still loads and means project scope. Old
    kitcrate reading a new lockfile just strips the key (zod drops unknown keys).
  - Preexisting detection only counts skills installed at the scope being installed into.
    `listSkills({ scope: 'all' })` returns both scopes, so without the filter a global add
    after a project add marked every member preexisting, installed nothing, and reported
    success while `~/.agents/skills` stayed empty.
  - `add` takes `--global` with no prompt, prompts with clack's `select` on a real TTY
    (cancel prints `Cancelled.` and exits 130), and takes `project` silently under
    `--yes`, `--json`, or no TTY.
  - `install`, `update`, and `remove` all pass `entry.scope` to the skills API.
    `removeCollectionSkills` now takes a scope like `installCollectionSkills` does.
  - The "already installed" check counts a skill only at the scope a command operates on.
    `install.ts` filters by `entry.scope` before deciding what to restore; without that,
    a collection locked global looked already restored when the skill sat in the project
    scope, so `kitcrate install` restored nothing. `update.ts` has no presence check to
    filter, because it diffs the manifest and removes through the adapter's ownership path.
  - `list` reports each collection's scope, as a `scope:` line and as `scope` in `--json`.
  - `--global` lives on the shared `CommandOptions`; only `add` reads it, because the other
    commands have no scope to choose.
- Local sources (`src/core/resolve.ts`), three fixes found while testing the scope feature:
  - A directory source read `collection.json` off the directory and threw EISDIR. It now
    resolves the directory first.
  - `file://` URLs fell through to the GitHub shorthand and became
    `https://github.com/file:///…`. They are now treated as **git** sources, matching
    upstream: the `skills` package clones a `file://` URL, so kitcrate clones it too.
    Reading the working tree while installing the clone would compare two different trees.
    A `file://` URL must therefore name a git repository, exactly as upstream requires.
  - A local path pinned `commit: ''`, which the lockfile schema then rejected on read even
    though `add` had just written it. The resolver now pins `git rev-parse HEAD` for a local
    git repo, and the schema tolerates an empty commit for a directory that is not one.
  - The installed-skill counts in `add` and `install` counted one entry per agent, so one
    skill read as "Installed 77 skill(s)". They now count distinct skill names.

- secrets.ts: `.env.example` files are now allowed (skipped during scan); `.env` and `.env.<variant>` (e.g. `.env.production`) remain blocked
- create.ts: publish flow rewritten to exclude credentials instead of blocking the whole publish.
  Writes a managed `.gitignore` (`.env`, `.env.*`, `!.env.example`), stages only
  `collection.json` + `.gitignore` + selected skill folders (never `git add .`), un stages
  credential files that are still tracked, scans the contents of every tracked file, and
  refuses to publish when existing git history already contains a credential file.
- New `--allow-secrets` flag: publish despite secret-pattern findings inside skill content
  (AGENTS.md requires an explicit override flag for the secret scan).
- New modules: `src/core/gitignore.ts` (managed ignore rules), `src/core/options.ts`
  (shared `CommandOptions`).
- Verified end-to-end with a mocked `gh`: `.env` excluded from the commit but kept on disk,
  `.env.example` published, secret inside a skill file blocked, credential-bearing history blocked.

- feat-017 Publish into a repository that already has remotes, and make the publish retryable:
  - Root cause: `gh repo create --source <dir> --push` defaults the new repository's remote
    name to `origin` and refuses when that name is taken. kitcrate never looked at the
    repository's remotes, so it handed `gh` a name that could not be added. The `gh` binary
    holds the literal `Unable to add remote %q`, while a missing repository and a taken name
    have different messages, which ruled those out.
  - `src/core/remote.ts` holds the policy as a pure function: `origin` when free, `github`
    when `origin` is taken, and a refusal naming both when neither is free. The refusal
    happens before the commit, so nothing is left behind. The author's remotes are never
    renamed or removed.
  - The remote name goes to `gh` as `--remote <name>` and into the JSON output. The human
    output says so when the name is not `origin`.
  - A failed publish left a commit behind, so the retry died on `git commit` with an empty
    tree. Git prints "nothing to commit" on stdout, which is why the message read
    `Failed to commit: ` with nothing after it. The commit is now skipped when the index
    already matches HEAD. That comparison replaced a check on git's wording, which is
    translated and differs when the repository holds untracked files.
  - The `git tag v0.1.0` result was discarded, so an existing tag silently pointed at the
    previous run's commit and `kitcrate add <source>@v0.1.0` would have installed the old
    manifest. It is now tolerated only when it points at HEAD, and otherwise stops the
    publish with a message naming both commits.
  - `git init` is checked instead of assumed.
  - The step comments in create.ts now follow AGENTS.md's 11-step flow instead of skipping
    numbers.
  - A release tag left by an earlier `kitcrate create` run moves to the commit this run made.
    kitcrate recognises its own collection commits by their subject, so the tag is kitcrate's to
    move. A tag kitcrate did not make is left alone, and the publish stops with a message that
    says so.

- Help handling: every command answers `--help` and `-h` with its own usage. The check lives in
  one place in `src/cli.ts`, so no command can treat the flag as an argument to act on. Each
  command module exports its usage text. `kitcrate validate --help` no longer looks for a file
  named `--help`, and `kitcrate create --help` no longer tries to clone a repo named `--help`.
- feat-018 (not started): `kitcrate validate` warns on a collection whose skill source is `.`,
  which is what `kitcrate create` writes. The resolver does not accept a bare `.` as a local
  path the way the `skills` package does, and a skill source has to resolve relative to the
  collection.json's own directory rather than the working directory.

- feat-019 (done): `kitcrate list` is a listing of skills, not of collections. One entry per
  (collection, skill) pair, each naming the skill and where it is installed, the agents it is
  installed for, the collection that brought it, and the source the skill itself came from.
  - The collection's `ref`, `commit`, `manifestHash`, and `only` left the human output. They
    stay in the JSON, which is the machine-readable view.
  - The double listing was two bugs. The output printed the collection's skill list and then
    the installed list. It also matched an installed skill by name alone, so a global skill
    that shared a name with a project member lent its path, its source, and its agent list to
    the project collection. The match is by name and scope now.
  - The path is abbreviated with `~` for the home directory, the agents line shows five
    display names and then `+N more`, and the JSON carries the agent ids next to the names.
  - The human output is coloured with Node's `styleText`, which is a no-op off a terminal, so
    a piped run stays plain without a second code path. The loading spinner appears only when
    the wait outlasts 300 ms, and it is erased when the work lands. It never runs in `--json`
    mode or off a terminal.
  - The listing reads only the scopes its collections use. Reading the global scope is the
    expensive half: it holds a copy of every skill for every agent on the machine. On this
    machine that is 7.9 s against 68 ms for the project scope, and the listing waited for all
    of it. A project-only listing is now about a second, most of it the CLI's own start-up.

- feat-020 (done): each member skill is installed from the source its manifest entry names.
  - `src/core/source.ts` turns a source into its GitHub `owner/repo` form (`owner/repo`,
    `github:owner/repo`, `https://github.com/...`, `git@github.com:...`, with or without a
    trailing `@ref`) and returns null for a local path or another host, so nothing guesses a
    repository. `displaySource` leaves an unparseable source as it is.
  - `kitcrate create` writes that form into `collection.json` for each selected skill, read
    through `listInstalledSkills` (the `skills` lock file). A skill with no recorded GitHub
    source records `.` and the command says which ones fell back and why.
  - `src/core/members.ts` groups a manifest's members by source and ref; `.` maps to the
    collection's own source and ref. `src/core/install-members.ts` is the one installer that
    `add`, `install`, and `update` call, so they cannot drift. `installCollectionSkills` now
    takes a `ref` and passes it upstream.
  - `kitcrate list` shows both `Collection:` and `Source:` as `owner/repo`. The JSON keeps the
    raw source, which mirrors the lock file.
  - The `withProgress` spinner moved out of `list.ts` into `src/commands/progress.ts`, next to
    the other terminal helper; `create` uses it for the lock file read, which scans every agent
    directory (about 7 s here).
  - The source lookup prefers an attributed copy over one that records no source, so a skill
    that sits in both scopes still names the repository it came from.
  - The collection's own source is handed to the installer in its normalized form, without
    the ref the user wrote after it: the `skills` package reads a trailing `@name` as a skill
    filter, so `owner/repo@v1` would look for a skill called `v1`.
  - `test/add.test.ts` replaces `installSkills` through `vi.mock` when a test sets
    `recordInstalls`, so the member-source test records what was asked for instead of fetching
    a remote repository. The create suite stubs the installed-skill lookup for the same reason
    and because the real machine's lock files would otherwise decide the result.

- feat-021 (done): `kitcrate publish` pushes a change to a collection that already exists.
  - `src/core/publish-targets.ts` gathers the candidates: every collection in the project's
    `kitcrate-lock.json` with its scope, plus every repository among the globally installed
    skills, since a global collection has no lockfile of its own. One repository recorded in two
    forms is listed once.
  - `src/core/publish-plan.ts` holds the pure logic: the folder diff, the member folder lookup
    by the name in `SKILL.md`, the parent directory a new member goes in, the patch bump, and
    the manifest rewrite.
  - `src/commands/publish.ts` clones the collection into a temporary directory — never the
    user's working tree — asks which collection to publish, offers the installed skills it does
    not have yet with the same picker `create` uses, copies the chosen ones in, copies over any
    local change to a member it already carries, rewrites `collection.json`, bumps the version,
    commits as `chore: collection <name> v<version>`, tags `v<version>`, and pushes.
  - A copied skill is a `.` member, so consumers install it from the collection's repository.
    Only a `.` member is updated from the local copy: a member served by another repository is
    installed from there, so a difference in its folder is reported rather than copied.
  - `gh api repos/{owner}/{repo} --jq .permissions.push` decides where it goes. With push access
    the collection's own repository is updated; without it, a new private repository is created
    under the user's account and the original is left alone.
  - `src/core/release.ts` now holds the release tag rule that `create` and `publish` share, and
    `src/core/secrets.ts` holds the credential exclusion both run before a push.
  - Review found three defects, all fixed: a collection pinned to a tag left the clone detached,
    so the push had no branch to send; a non-interactive run with several collections installed
    published the first one without saying so; and an installed skill with no folder was
    reported as changed but never copied.

- feat-018 (done): `kitcrate validate` understands a `.` member.
  - `kitcrate validate` warned on every collection `kitcrate create` publishes. A member whose
    source is `.` is what `create` writes for a skill that lives in the collection itself, but
    the validator passed the bare `.` to `resolveCollection`, which rejects it as an invalid
    collection source. The warning was false and appeared on every published collection.
  - The validator in `src/commands/validate.ts` now classifies a member source. A source that is
    not a GitHub repository (`githubOwnerRepo` returns null) is local to the collection, so it is
    resolved against the directory holding the `collection.json` under validation instead of the
    network. A `.` member, being in its own collection by definition, validates without a warning.
  - The resolver in `src/core/resolve.ts` is unchanged: it is shared with `add`, `install`, and
    `update`, which never feed it a bare `.` as a source (they resolve the collection first and
    map `.` to its source in `src/core/members.ts`). Widening `parseSource` would have risked
    those callers.
  - `test/validate.test.ts` proves a `.` member validates clean and that a non-local source that
    cannot be reached still warns, so the remote path is untouched.

- Released on npm (0.1.1): kitcrate is published. `npm install -g kitcrate` gives the
  `kitcrate` binary, and a plain `npm install kitcrate` in a project does too.
  - `package.json` now declares what the registry and a consumer need: `files: ["dist/"]` so
    only the built CLI ships and the source, tests, and agent docs stay in the repository;
    `main`, `types`, the `repository`, `bugs`, and `homepage` URLs, keywords, and `license: MIT`.
    `prepublishOnly` runs typecheck, lint, test, and build, so a broken tree cannot be published.
  - **0.1.0 shipped broken: the installed package did nothing.** The entry-point guard in
    `src/cli.ts` compared `import.meta.url`'s pathname with `process.argv[1]` literally. npm links
    a bin into `node_modules/.bin`, so the installed CLI starts through a symlink: `argv[1]` names
    the symlink, while `import.meta.url` names the file behind it. The two never matched, `main()`
    never ran, and `kitcrate --help` exited 0 printing nothing. Running from a checkout hid it,
    because there `argv[1]` is the real file.
  - Fixed in 0.1.1: both sides are resolved through `realpathSync` before comparing, which also
    fixes a percent-encoded pathname for a directory with a space in its name. `test/cli.test.ts`
    runs the built bundle through a symlink in a subprocess, so the case an install creates is the
    case the suite checks.
