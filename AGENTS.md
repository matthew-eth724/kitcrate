# AGENTS.md

Guidance for AI coding agents working on **kitcrate**, a CLI for publishing and installing collections of agent skills.

## What this project is

kitcrate is a thin collections layer on top of Vercel Labs' [`skills`](https://github.com/vercel-labs/skills) CLI. `skills` installs individual skills but has no collection format. kitcrate adds one: author a collection, publish it to GitHub, install the whole set into a project, and keep it updated.

Git is the backend: no server, no registry in v1. GitHub access goes through the `gh` CLI, never custom OAuth.

## Do not rebuild what `skills` already does

kitcrate depends on the `skills` package and uses its public API (`resolveSource`, `installSkills`, `listSkills`, `removeSkills`). Never reimplement:

- Source parsing (`owner/repo[@skill]`, git URLs, local paths)
- Skill discovery and `SKILL.md` frontmatter parsing
- Installing, symlink/copy modes, or agent detection (75+ agents)
- `skills-lock.json` (project lock). `skills` owns it; kitcrate never writes it directly, only through the API.

`skills` API calls never prompt, print, or exit. Progress comes through `onProgress`, warnings through `onWarning`, errors as `SKILLS_*` diagnostics. Surface these in kitcrate's own UI.

## Core concepts

- **Skill**: a folder with `SKILL.md` (frontmatter: `name`, `description`).
- **Collection**: a git repo (or repo subfolder) with `collection.json` at its root. One collection = one repo by default.
- **Collection manifest** (`collection.json`): written by the author. Lists skill *references*, which may span multiple repos. Answers "what does this collection offer?"
- **Collection lockfile** (`kitcrate-lock.json`): written by kitcrate in the consumer's project, committed, never hand-edited. Answers "which collections are installed, at what version, and which skills belong to each?"

There is no project manifest. The lockfile records the user's intent (source, ref, `only` filter) as well as resolved state.

**Hard rule:** the publisher never creates a lockfile. Only `add`, `install`, `update`, and `remove` write it.

### Collection manifest

```json
{
  "name": "web-security",
  "version": "1.2.0",
  "description": "Web app security review skills",
  "skills": [
    { "source": "acme/web-security", "skill": "xss-review" },
    { "source": "acme/web-security", "skill": "sqli-checks" },
    { "source": "other/shared-skills", "skill": "burp-notes", "ref": "v2" }
  ]
}
```

Keep the entry shape (`source`, `skill`, optional `ref`) aligned with skills.sh packs so the formats stay compatible.

### Collection lockfile

```json
{
  "version": 1,
  "collections": {
    "web-security": {
      "source": "github:acme/web-security",
      "ref": "v1",
      "commit": "9f3a1c2...",
      "manifestHash": "sha256-ab12...",
      "only": ["xss-review"],
      "skills": ["xss-review", "sqli-checks"],
      "preexisting": ["xss-review"]
    }
  }
}
```

- `commit` and `manifestHash` pin the exact `collection.json` that was resolved, so `update` can diff old against new.
- `skills` lists member skills by **name only**. Per-skill source, commit, and file hash live in `skills-lock.json`. One source of truth; both files must be committed.
- `preexisting` lists member skills that were already installed (for example via `skills add`) when the collection was added. kitcrate never deletes these on `remove`.
- Same conventions as `skills-lock.json`: sorted keys, atomic writes, versioned format. An unknown version fails with a clear message. Never silently wipe or rewrite it.

## Commands

| Command | Behavior |
|---|---|
| `kitcrate add <source>` | Fetch `collection.json`, install member skills via `skills`, write `kitcrate-lock.json`. Asks whether to install into the project or globally |
| `kitcrate install` | Restore all collections from both lockfiles; verify `manifestHash` |
| `kitcrate update [name]` | Re-resolve ref, diff manifests, add/remove/bump skills, rewrite lock |
| `kitcrate remove <name>` | Remove a collection; delete only skills kitcrate installed itself (see ownership rules) |
| `kitcrate list` | Show installed collections, their scope, and their skills |
| `kitcrate create` | Publish flow (below) |
| `kitcrate validate [path]` | Check `collection.json` and referenced skills |

### Install scope

`kitcrate add` asks where the collection's skills go. The choice is recorded per collection in `kitcrate-lock.json` and every later command follows it.

- **project**: skills land in `<project>/.agents/skills`. The default, and what `add` did before the scope existed.
- **global**: skills land in `~/.agents/skills`, shared across every project on the machine.
- The prompt is skipped under `--yes`, `--json`, and any non-TTY run, where the scope is `project`. `--global` selects the global scope without prompting.
- The scope is a per-collection field, not a per-lockfile one. `kitcrate-lock.json` stays in the project; a global collection is still recorded in the project that asked for it.
- A skill counts as already installed only at the **same** scope. The same skill can sit in both scopes at once, so an unscoped check would make a global `add` silently install nothing.
- `src/core/scope.ts` owns the scope type and the directory shown in the prompt. The install itself always goes through the `skills` API.

### Ownership rules

kitcrate only removes skills it installed itself.

- On `add`, record every member skill that already exists in `skills-lock.json` in `preexisting`. Do not overwrite them silently: if a preexisting skill differs in source or commit from what the collection wants, warn and ask (or fail under `--yes`).
- On `remove`, delete a skill only if it is in the collection's `skills`, is **not** in its `preexisting`, and is not claimed by any other collection.
- Before deleting, compare the skill's `skills-lock.json` entry with what kitcrate installed. If it no longer matches (for example the user later ran `skills add` on it), leave the skill in place and report it.
- Skills in `skills-lock.json` that no collection lists are direct installs and are never touched.

### `kitcrate create` flow

1. Discover skills with the `skills` CLI's own discovery (`resolveSource` on the local directory). Never hand-roll a scan or parse `SKILL.md` frontmatter.
2. Validate each; show errors.
3. Prompt for name, description, visibility (default **private**; confirm explicitly if public).
4. Multi-select skills to include: space toggles, Enter finalizes. The list shows skill names only, each starting as an empty box that becomes a green tick when ticked. Nothing is pre-ticked; the author chooses what goes in.
5. Write a `.gitignore` that ignores `.env` and `.env.*` but keeps `!.env.example`.
6. Write `collection.json`. Default mode is references; offer "copy skills into the repo" as an option.
7. `git init`, then stage only `collection.json`, `.gitignore`, and the selected skill folders. Never `git add .`.
8. Publish gate: unstage credential files (`.env`, `.env.*`, `.netrc`, `.npmrc`, …) so they stay on disk but are never pushed; scan the contents of every tracked file; warn when the repository's existing history already contains a credential file; refuse when the repository already has staged changes, because the commit takes the whole index.
9. Commit, tag `v0.1.0`.
10. `gh repo create <name> --<visibility> --source . --push --remote <name>`.
11. Print the install command: `kitcrate add github:<user>/<name>`.

### Publishing into a repository that already has remotes

`gh repo create` defaults the new repository's remote name to `origin` and refuses when that name is taken. kitcrate chooses a free name itself, in `src/core/remote.ts`: `origin` when it is free, otherwise `github`. The author's own remotes are never renamed or removed. When neither name is free, the publish stops before the commit, with a message saying which names are taken.

The remote name is reported in the JSON output and, when it is not `origin`, in the human output too, so the author knows the new repository is not on `origin`.

### Retrying a publish

`kitcrate create` converges on the published state whether or not a previous run got that far.

- The commit is skipped when the index already matches `HEAD`, which is the case after a failed publish left the collection committed. kitcrate compares the index against `HEAD` rather than reading git's refusal, because that message is translated and comes in more than one wording.
- A `v0.1.0` tag that already exists is tolerated when it points at `HEAD`. When it points at an earlier commit that kitcrate itself made, the tag moves to the commit this run made, because that commit holds the collection being published. A tag kitcrate did not make is left alone and the publish stops: the tag would resolve to an older manifest, so `kitcrate add <source>@v0.1.0` would install the wrong release.
- `git init` is checked rather than assumed, so a repository that could not be initialized stops the run instead of carrying on against whatever state is there.

### Collection name convention

- Names are lowercase, alphanumeric, with hyphens between segments: `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`.
- Author input is **parsed** into that convention by `normalizeCollectionName` in `src/core/name.ts`: trimmed, lowercased, whitespace runs become hyphens, repeated and edge hyphens collapse.
- Characters outside `[a-z0-9-]` are **not** guessed at. They raise the convention error and the prompt refuses the input.
- The `collection.json` schema still rejects invalid names. Normalization happens only at the author prompt, so the published contract stays strict.
- Under `--yes` and `--json`, the name comes from the source directory's folder name, normalized the same way.

## Security rules (non-negotiable)

- Never store or log tokens. Delegate auth to `gh` (check `gh auth status`); fall back to plain `git` with existing credentials.
- Never execute scripts from a skill during install. Show a trust prompt listing any scripts a collection's skills contain.
- Credential files (`.env`, `.env.*`, `.netrc`, `.npmrc`, …) are excluded from the commit, never published. `.env.example` is publishable.
- Secret findings never block a publish. The scan reports private keys and common API key patterns in the files that would be pushed, and the publish goes ahead. Only credential files are kept out of the commit, because exclusion prevents them from being published rather than stopping the publish.
- Treat fetched manifests as untrusted. Validate with zod; reject path traversal and entries that escape the repo.
- Verify `manifestHash` on install and fail loudly on mismatch.
- Never publish publicly without explicit confirmation.
- Respect `DISABLE_TELEMETRY=1` and `DO_NOT_TRACK=1` (also honored by `skills`). kitcrate adds no telemetry of its own.

## Tech stack and layout

TypeScript, strict mode, Node 20+, pnpm. Distributed on npm as `kitcrate` (binary: `kitcrate`). Shell out to `git` and `gh`; do not reimplement them.

```
src/
  cli.ts          # entry and command dispatch
  commands/       # add, install, update, remove, list, create, validate
  core/
    manifest.ts   # collection.json schema (zod)
    lockfile.ts   # kitcrate-lock.json read/write/verify
    resolve.ts    # fetch collection.json at ref -> commit SHA
    hash.ts       # manifestHash
    name.ts       # collection name normalization
    scope.ts      # install scope (project | global) and its directory
    secrets.ts    # pre-publish scanner
    remote.ts     # which remote name the new repository is published under
  skills/         # the only module that imports from `skills`
  git/            # thin wrappers around git and gh
test/
```

Isolate the `skills` dependency in `src/skills/`. If its API changes, only that folder should break.

## Conventions

- Strict TypeScript, no `any`. Validate every file read from disk or network with zod.
- Commands are thin; logic lives in `core/` so it is testable without a TTY.
- Every command supports `--yes` for non-interactive use and `--json` for machine-readable output.
- `kitcrate create` accepts `--allow-secrets` for compatibility with older scripts, but it does nothing: secret findings never block a publish.
- Errors: actionable message, nonzero exit code, no stack traces unless `--debug`.
- JSON files: 2-space indent, sorted keys, trailing newline, so diffs stay clean.
- Prettier for formatting, matching `skills`.

## Testing

- Unit tests for manifest validation, hashing, lockfile read/write, and secret scanning.
- Integration tests use local bare git repos as fake remotes; never hit GitHub in tests.
- Mock `gh` via a stub on `PATH`.
- Before finishing any task: run lint, typecheck, and tests.

## Non-goals (v1)

No hosted registry, search, or accounts. No forking of `skills`. No second skill installer. No inter-collection dependencies. Don't build these unprompted.

## Roadmap

1. Core: manifest schema, lockfile, resolver, `src/skills/` adapter.
2. Consume: `add`, `install`, `list`, `update`, `remove`.
3. Author: `validate`, `create`.
4. Later: static registry index, collection dependencies, upstream proposal to `skills` for native collection support.

## Agent startup & done

### Startup Workflow

**Before writing code:** read `AGENTS.md`, then `feature_list.json` and `progress.md`, then `session-handoff.md` if present. Run `./init.sh` (or `pnpm install && pnpm typecheck && pnpm lint && pnpm test`) before editing.

- Work on **one feature at a time**, in `feature_list.json` dependency order. Mark status `in-progress` only when actively implementing.

### Definition of Done

A feature is done **only when**: implementation is complete, verification passes (`./init.sh` green), evidence is recorded in `feature_list.json` (evidence field) and `progress.md`, and status is set to `done`.

### Verification Commands

`./init.sh` runs `pnpm typecheck`, `pnpm lint`, and `pnpm test`. All must pass before claiming a feature done.

### End of Session

**Before ending a session:** update `progress.md` and `session-handoff.md` with files changed, decisions, blockers, and the recommended next step.

## Working agreements for agents

- Ask before changing `collection.json` or `kitcrate-lock.json` formats; they are public contracts.
- Keep changes small and scoped to one concern per commit.
- Update this file when a decision here changes.
