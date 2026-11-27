import { isCancel, select } from '@clack/prompts';
import {
  readLockfile,
  writeLockfile,
  type CollectionLockEntry,
  type Lockfile,
} from '../core/lockfile.js';
import { installMembers, MemberInstallError } from '../core/install-members.js';
import { resolveCollection } from '../core/resolve.js';
import { DEFAULT_SCOPE, scopeDirectory, type InstallScope } from '../core/scope.js';
import { listInstalledSkills, type InstalledMember } from '../skills/index.js';
import type { CommandOptions } from '../core/options.js';

/** Exit code for a cancelled prompt, matching `create`. */
const EXIT_CANCELLED = 130;

/** Usage text for `kitcrate add`. */
export const ADD_USAGE = `Usage: kitcrate add <source> [--global]

Fetch collection.json from a source, install its member skills via skills,
and write an entry to kitcrate-lock.json.

Arguments:
  <source>   Collection source: owner/repo[@ref], github:owner/repo[@ref],
             a git URL, or a local path.

Options:
  --yes      Non-interactive use: install into this project, no prompts
  --json     Machine-readable output
  --global   Install into ~/.agents/skills instead of the project, no prompt
  --debug    Include stack traces on errors

Example:
  kitcrate add acme/web-security
  kitcrate add github:acme/web-security@v1.2.0
  kitcrate add acme/web-security --global`;

/** Handle the `kitcrate add <source>` command. */
export async function addCommand(argv: string[], options: CommandOptions): Promise<number> {
  const { yes, json, global } = options;
  if (argv.length === 0) {
    console.error(ADD_USAGE);
    return 1;
  }

  const source = argv[0];

  try {
    // 1. Resolve the collection source (fetch collection.json, pin commit, compute hash).
    const resolved = await resolveCollection(source);
    const manifest = resolved.manifest;

    // 2. Read existing lockfile (or start empty).
    const cwd = process.cwd();
    const lockfile = await readLockfile(cwd);

    // 3. Check for conflicts: collection already installed under same name.
    if (lockfile.collections[manifest.name]) {
      const existing = lockfile.collections[manifest.name];
      const message = `Collection "${manifest.name}" is already installed (source: ${existing.source}, ref: ${existing.ref}). `;
      if (yes) {
        console.error(
          `${message}Use --yes to override is not supported for add; use kitcrate update instead.`
        );
      } else {
        console.error(`${message}Use \`kitcrate update ${manifest.name}\` to update it instead.`);
      }
      return 1;
    }

    // 4. Choose where the skills go, before anything touches disk.
    const scope = await chooseScope({ global, yes, json, cwd });
    if (scope === null) {
      console.log('Cancelled.');
      return EXIT_CANCELLED;
    }

    // 5. Determine preexisting skills in the chosen scope (already installed).
    const installedSkills = await listInstalledSkills({ cwd });
    const installedNames = new Set(
      installedSkills.filter((s) => s.scope === scope).map((s) => s.name)
    );
    const requestedSkills = manifest.skills.map((s) => s.skill);
    const preexisting = requestedSkills.filter((name) => installedNames.has(name));

    // 6. Warn about preexisting skills (they will not be overwritten).
    for (const skill of preexisting) {
      console.warn(
        `Warning: skill "${skill}" is already installed and will not be overwritten by this collection.`
      );
    }

    // 7. Install member skills via skills (only those not preexisting), each
    // from the source its manifest entry names.
    const skillsToInstall = requestedSkills.filter((name) => !preexisting.includes(name));

    let installed: InstalledMember[] = [];
    if (skillsToInstall.length > 0) {
      try {
        const result = await installMembers(resolved, {
          scope,
          only: skillsToInstall,
          cwd,
        });
        installed = [...result.installed];
      } catch (error) {
        if (!(error instanceof MemberInstallError)) throw error;
        console.error(error.message);
        return 1;
      }
    }

    // 8. Write kitcrate-lock.json entry.
    const entry: CollectionLockEntry = {
      source: resolved.source,
      ref: resolved.ref ?? 'HEAD',
      commit: resolved.commit,
      manifestHash: resolved.manifestHash,
      skills: requestedSkills,
      preexisting,
      scope,
      ...(requestedSkills.length > 0 && { only: requestedSkills }),
    };

    const updated: Lockfile = {
      version: 1,
      collections: {
        ...lockfile.collections,
        [manifest.name]: entry,
      },
    };

    await writeLockfile(cwd, updated);

    // 9. Output result.
    const directory = scopeDirectory(scope, cwd);
    if (json) {
      console.log(
        JSON.stringify(
          {
            collection: manifest.name,
            source: resolved.source,
            commit: resolved.commit,
            scope,
            directory,
            installed: installedSkillCount(installed),
            preexisting: preexisting.length,
          },
          null,
          2
        )
      );
    } else {
      console.log(
        `Added collection "${manifest.name}" from ${resolved.source}@${resolved.ref ?? 'HEAD'} (commit ${resolved.commit.slice(0, 7)})`
      );
      console.log(`  Scope: ${scope} (${directory})`);
      console.log(
        `  Installed ${installedSkillCount(installed)} skill(s); ${preexisting.length} preexisting skill(s) left untouched.`
      );
      console.log(`  Lockfile entry written to kitcrate-lock.json.`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to add collection from "${source}": ${message}`);
    return 1;
  }
}

/** Prompting needs a real terminal on both ends; piping either one makes clack unusable. */
function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Pick the install scope. `--global` wins outright; an interactive run asks;
 * `--yes`, `--json`, and non-TTY runs take the default without prompting.
 * Returns null when the user cancelled the prompt.
 */
async function chooseScope(context: {
  readonly global: boolean;
  readonly yes: boolean;
  readonly json: boolean;
  readonly cwd: string;
}): Promise<InstallScope | null> {
  const { global, yes, json, cwd } = context;
  if (global) return 'global';

  if (yes || json || !isInteractive()) {
    if (!json) console.log(`Scope: ${DEFAULT_SCOPE} (no prompt in non-interactive mode).`);
    return DEFAULT_SCOPE;
  }

  const answer = await select({
    message: 'Install where?',
    options: [
      { value: 'project', label: 'This project', hint: scopeDirectory('project', cwd) },
      { value: 'global', label: 'Globally', hint: scopeDirectory('global', cwd) },
    ],
    initialValue: DEFAULT_SCOPE,
  });
  if (isCancel(answer)) return null;
  return answer;
}

/**
 * How many distinct skills were installed. The `skills` API reports one entry
 * per agent it installed into, so counting entries would count one skill many
 * times over.
 */
function installedSkillCount(installed: readonly InstalledMember[]): number {
  return new Set(installed.map((member) => member.name)).size;
}
