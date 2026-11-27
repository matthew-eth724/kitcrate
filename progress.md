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

### What's In Progress

- none

### What's Next

- All 13 features complete. Next steps would be integration tests with local bare git repos as fake remotes (the create command now has one; the consumer commands still do not).

## Blockers / Risks

- None currently

## Decisions Made

- `skills` package pinned via `file:../skills-cli` in package.json; built with `pnpm build` in skills-cli
- Node16 module resolution with `.js` extensions in import paths
- All core modules typecheck clean with strict TypeScript
- Name normalization lives in `src/core/name.ts` as a pure function returning a discriminated union, so an invalid name is unrepresentable in the success branch. The `collection.json` schema still rejects invalid names.
- Skill discovery is delegated to the `skills` CLI through `discoverSkillsInDirectory` in `src/skills/index.ts`. kitcrate's hand-rolled scan and frontmatter parser were deleted, as AGENTS.md requires.
- All prompts in `create` moved from `readline` to `@clack/prompts` so one library owns stdin and raw-mode handling; mixing the two breaks the multiselect.
- The `create` commit takes the whole git index, so the command now refuses to publish when the repository already has staged changes rather than silently publishing the author's files.
- `gh` now goes through a `gh()` wrapper in `src/git/index.ts`, matching AGENTS.md's "thin wrappers around git and gh".
- The picker draws itself. clack hardcodes its checkbox symbols, so `src/commands/pick-skills.ts` builds on `@clack/core`'s `MultiSelectPrompt` for the keyboard handling and renders the list with an empty box and a green tick.
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
