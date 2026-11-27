import { writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { confirm, isCancel, log, select, text } from '@clack/prompts';
import {
  excludeCredentialFiles,
  isCredentialFileName,
  scanFilesForSecrets,
} from '../core/secrets.js';
import { ensureEnvIgnoreRules } from '../core/gitignore.js';
import { type CollectionManifest } from '../core/manifest.js';
import { computeManifestHash } from '../core/hash.js';
import { normalizeCollectionName } from '../core/name.js';
import { withProgress } from './progress.js';
import { chooseRemoteName } from '../core/remote.js';
import { ensureReleaseTag } from '../core/release.js';
import { resolveMemberSources } from '../core/member-sources.js';
import { discoverSkillsInDirectory, type DiscoveredSkill } from '../skills/index.js';
import { pickSkills } from './pick-skills.js';
import {
  git,
  gh,
  hasCommits,
  listCommittedFiles,
  listRemotes,
  listStagedChanges,
  listTrackedFiles,
  stagePaths,
} from '../git/index.js';
import type { CommandOptions } from '../core/options.js';

/** Human-readable output, suppressed when the caller asked for JSON. */
function say(json: boolean, message: string): void {
  if (!json) console.log(message);
}

/** Usage text for `kitcrate create`. */
export const CREATE_USAGE = `Usage: kitcrate create [path]

Publish a collection: discover the skills in a directory, prompt for the
collection's name, description, and visibility, choose which skills to
include, write collection.json and a .gitignore, then commit, tag v0.1.0,
and create the GitHub repository.

Arguments:
  [path]   Directory holding the skills to publish. Defaults to the current directory.

Options:
  --yes     Non-interactive use: take every discovered skill, publish private
  --json    Machine-readable output
  --debug   Include stack traces on errors`;

/** Handle the `kitcrate create` command. */
export async function createCommand(argv: string[], options: CommandOptions): Promise<number> {
  const { yes, json } = options;
  const sourceDir = argv[0] ?? process.cwd();

  try {
    // 1. Discover skills with the `skills` CLI's own discovery.
    const skipped: string[] = [];
    const discovered = await discoverSkillsInDirectory(sourceDir, {
      onWarning: (warning) => skipped.push(warning.message),
    });
    if (skipped.length > 0) {
      console.error(`Skipped ${skipped.length} invalid skill(s):`);
      for (const warning of skipped) {
        console.error(`  ${warning}`);
      }
    }
    if (discovered.length === 0) {
      console.error(
        `No skills found in ${sourceDir}. Each skill must be in a directory with SKILL.md.`
      );
      return 1;
    }

    const defaultName = deriveDefaultName(sourceDir);
    const defaultDescription = `Collection of ${discovered.length} skill(s)`;

    // Steps 2 to 4: validate each skill, prompt for the collection's details,
    // and choose which skills to include.
    const inputs = await collectInputs({
      discovered,
      nonInteractive: yes || json || !isInteractive(),
      json,
      defaultName,
      defaultDescription,
    });
    if (!inputs.ok) return inputs.exitCode;

    const { name, description, visibility, selectedSkills } = inputs;

    // A skill at the source root is the whole directory, so everything in it
    // is published. Say so rather than let the author discover it later.
    const rootSkills = selectedSkills.filter((skill) => isRootPath(skill.path));
    if (rootSkills.length > 0) {
      say(
        json,
        `Note: ${rootSkills.map((skill) => skill.name).join(', ')} lives at the source root, so every file in that directory is published.`
      );
    }

    // Step 5: write the .gitignore.
    const gitignoreStatus = await ensureEnvIgnoreRules(sourceDir);

    // Step 6. Write collection.json. Each member records where the skill itself
    // came from, so the installers fetch it from its own repository instead of
    // this one.
    const sources = await withProgress(json, 'Reading where these skills came from', () =>
      resolveMemberSources(selectedSkills)
    );
    if (sources.unattributed.length > 0) {
      say(
        json,
        `Recording source "." for ${sources.unattributed.length} skill(s), which installs them from this collection:`
      );
      for (const { skill, reason } of sources.unattributed) {
        say(json, `  - ${skill}: ${reason}`);
      }
    }

    const manifest: CollectionManifest = {
      name,
      version: '0.1.0',
      description,
      skills: selectedSkills.map((s) => ({
        source: sources.byName.get(s.name) ?? '.',
        skill: s.name,
      })),
    };

    const collectionJson = JSON.stringify(manifest, null, 2) + '\n';
    const manifestHash = computeManifestHash(collectionJson);

    await writeFile(join(sourceDir, 'collection.json'), collectionJson, 'utf8');

    // Step 7. git init, then stage only what belongs in the collection.
    const initResult = await git(['init'], sourceDir);
    if (initResult.code !== 0) {
      const detail = initResult.stderr.trim() || initResult.stdout.trim();
      console.error(`Failed to initialize a git repository in ${sourceDir}: ${detail}`);
      return 1;
    }

    // The new repository's remote has to be a name `gh` can add. Decide it
    // before the commit so a refusal leaves nothing behind.
    const remoteChoice = chooseRemoteName(await listRemotes(sourceDir));
    if (!remoteChoice.ok) {
      console.error(remoteChoice.reason);
      return 1;
    }
    const remote = remoteChoice.name;

    // The commit takes the whole index, so anything the author had already
    // staged would be published too. Refuse rather than publish their files.
    const preStaged = await listStagedChanges(sourceDir);
    if (preStaged.length > 0) {
      console.error(
        'This repository already has staged changes. kitcrate create publishes only the collection files:'
      );
      for (const path of preStaged) {
        console.error(`  - ${path}`);
      }
      console.error('Unstage them with `git reset`, then run kitcrate create again.');
      return 1;
    }

    const skillPaths = selectedSkills.map((skill) => skill.path);
    await stagePaths(sourceDir, ['collection.json', '.gitignore', ...skillPaths]);

    // Step 8. Publish gate: nothing credential-shaped may reach the remote.
    const excluded = await excludeCredentialFiles(sourceDir);
    if (excluded.length > 0) {
      say(json, `Excluded ${excluded.length} credential file(s) from the publish:`);
      for (const path of excluded) {
        say(json, `  - ${path}`);
      }
    }

    const tracked = await listTrackedFiles(sourceDir);
    const contentFindings = await scanFilesForSecrets(sourceDir, tracked);
    if (!contentFindings.clean) {
      console.error(
        `Secret scan found ${contentFindings.findings.length} potential secret(s) in files that would be pushed:`
      );
      for (const f of contentFindings.findings) {
        console.error(`  ! ${f.path}: ${f.message}`);
      }
    }

    // Step 8, continued. Warn when the history already holds credentials.
    // Publishing is not
    // blocked, but the author should know those commits go to the remote too.
    if (await hasCommits(sourceDir)) {
      const committed = await listCommittedFiles(sourceDir);
      const leaked = committed.filter((p) => isCredentialFileName(basename(p)));
      if (leaked.length > 0) {
        console.error(
          `Warning: this repository's history already contains ${leaked.length} credential file(s):`
        );
        for (const p of leaked) {
          console.error(`  ! ${p}`);
        }
        console.error('Publishing will push them along with the new commit.');
      }
    }

    // Step 9. Commit and tag v0.1.0.
    const tag = 'v0.1.0';
    // A retry after a failed publish finds the collection already committed.
    // Compare the index against HEAD instead of reading git's refusal, which
    // comes out in the user's language and in more than one wording.
    const alreadyCommitted =
      (await git(['diff', '--cached', '--quiet', 'HEAD'], sourceDir)).code === 0;
    if (!alreadyCommitted) {
      const commitResult = await git(
        ['commit', '-m', `chore: initial collection ${name} v0.1.0`],
        sourceDir
      );
      if (commitResult.code !== 0) {
        console.error(
          `Failed to commit: ${commitResult.stderr.trim() || commitResult.stdout.trim()}`
        );
        return 1;
      }
    }

    const tagResult = await ensureReleaseTag(sourceDir, tag);
    if (!tagResult.ok) {
      console.error(tagResult.reason);
      return 1;
    }
    if (tagResult.moved) {
      say(
        json,
        `Moved the ${tag} tag to this commit; an earlier kitcrate create run left it on an older one.`
      );
    }

    // Step 10. gh repo create, under the remote name chosen above.
    const visibilityFlag = visibility === 'public' ? '--public' : '--private';
    const ghResult = await gh(
      ['repo', 'create', name, visibilityFlag, '--source', sourceDir, '--remote', remote, '--push'],
      sourceDir
    );
    if (ghResult.code !== 0) {
      const detail = ghResult.stderr.trim() || ghResult.stdout.trim();
      console.error(`Failed to create GitHub repo: ${detail}`);
      return 1;
    }

    // Step 11. Report the result.
    const result = {
      name,
      version: manifest.version,
      description,
      visibility,
      remote,
      skills: manifest.skills.map((member) => ({ name: member.skill, source: member.source })),
      manifestHash,
      gitignore: gitignoreStatus,
      excluded,
      published: true,
    };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    console.log(`\nCollection "${name}" published (v0.1.0).`);
    if (remote !== 'origin') {
      console.log(`  published to the "${remote}" remote, because "origin" was already taken.`);
    }
    for (const member of manifest.skills) {
      console.log(
        `  ${member.skill}: from ${member.source === '.' ? 'this collection' : member.source}`
      );
    }
    console.log(`  manifestHash: ${manifestHash}`);
    console.log(`  .gitignore: ${gitignoreStatus}`);
    if (excluded.length > 0) {
      console.log(`  excluded from publish: ${excluded.join(', ')}`);
    }
    console.log(`\nInstall with:`);
    console.log(`  kitcrate add github:<user>/${name}`);

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create collection: ${message}`);
    return 1;
  }
}

/** What the user chose for the collection being created. */
interface CollectionInputs {
  readonly name: string;
  readonly description: string;
  readonly visibility: 'private' | 'public';
  readonly selectedSkills: readonly DiscoveredSkill[];
}

/** Either the collected inputs or an exit code, so a cancel or refusal cannot be mistaken for success. */
type CollectedInputs =
  ({ readonly ok: true } & CollectionInputs) | { readonly ok: false; readonly exitCode: number };

/** A prompt was cancelled: clack reports it with a distinct symbol rather than by throwing. */
const MODE_EXIT_CANCELLED = 130;

/** Prompting needs a real terminal on both ends; piping either one makes clack unusable. */
function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** Whether a discovered skill sits at the root of the scanned directory. */
function isRootPath(path: string): boolean {
  return path === '' || path === '.' || path === './';
}

/**
 * Best guess at the collection name from the source directory's own name,
 * already in the convention. Falls back to `collection` when the folder name
 * yields nothing usable (`.` or `/`, say, or a path whose last segment an
 * interactive shell cannot see).
 */
function deriveDefaultName(sourceDir: string): string {
  const resolved = resolve(sourceDir);
  const candidate = normalizeCollectionName(basename(resolved));
  return candidate.ok ? candidate.name : 'collection';
}

/**
 * Gather the name, description, visibility, and skill selection.
 * `--yes`, `--json`, and non-TTY runs take the defaults and every skill.
 */
async function collectInputs(context: {
  readonly discovered: readonly DiscoveredSkill[];
  readonly nonInteractive: boolean;
  readonly json: boolean;
  readonly defaultName: string;
  readonly defaultDescription: string;
}): Promise<CollectedInputs> {
  const { discovered, nonInteractive, json, defaultName, defaultDescription } = context;

  if (nonInteractive) {
    say(json, 'Non-interactive: no prompts, every discovered skill was selected.');
    const normalized = normalizeCollectionName(defaultName);
    if (!normalized.ok) {
      console.error(
        `${normalized.reason} Rename the directory or pass an explicit collection name.`
      );
      return { ok: false, exitCode: 1 };
    }
    return {
      ok: true,
      name: normalized.name,
      description: defaultDescription,
      visibility: 'private',
      selectedSkills: discovered,
    };
  }

  const nameAnswer = await text({
    message: 'Collection name',
    placeholder: defaultName,
    validate: (value) => {
      const candidate = value === undefined || value.trim() === '' ? defaultName : value;
      const result = normalizeCollectionName(candidate);
      return result.ok ? undefined : result.reason;
    },
  });
  if (isCancel(nameAnswer)) return cancelled();

  const typedName = nameAnswer.trim() === '' ? defaultName : nameAnswer;
  const normalizedName = normalizeCollectionName(typedName);
  if (!normalizedName.ok) {
    console.error(normalizedName.reason);
    return { ok: false, exitCode: 1 };
  }
  if (normalizedName.changed) {
    log.info(`Collection name normalized to "${normalizedName.name}".`);
  }

  const descriptionAnswer = await text({
    message: 'Description',
    placeholder: defaultDescription,
  });
  if (isCancel(descriptionAnswer)) return cancelled();
  const description = descriptionAnswer.trim() === '' ? defaultDescription : descriptionAnswer;

  const visibilityAnswer = await select({
    message: 'Visibility',
    options: [
      { value: 'private', label: 'private', hint: 'only you can see the repo' },
      { value: 'public', label: 'public', hint: 'anyone can install the collection' },
    ],
    initialValue: 'private',
  });
  if (isCancel(visibilityAnswer)) return cancelled();
  const visibility = visibilityAnswer === 'public' ? 'public' : 'private';

  if (visibility === 'public') {
    const confirmed = await confirm({
      message: `Publish "${normalizedName.name}" as a PUBLIC GitHub repository? Anyone will be able to read it.`,
      initialValue: false,
    });
    if (isCancel(confirmed)) return cancelled();
    if (!confirmed) {
      console.error('Publication cancelled: public visibility was not confirmed.');
      return { ok: false, exitCode: 1 };
    }
  }

  const selection = await pickSkills(
    'Select skills to include',
    discovered.map((skill) => ({ value: skill.name, label: skill.name }))
  );
  if (selection === null) return cancelled();

  const chosen = new Set(selection);
  const selectedSkills = discovered.filter((skill) => chosen.has(skill.name));
  if (selectedSkills.length === 0) {
    console.error('At least one skill must be selected: a collection cannot be empty.');
    return { ok: false, exitCode: 1 };
  }

  return { ok: true, name: normalizedName.name, description, visibility, selectedSkills };
}

/** Report a cancelled prompt and signal the caller to exit with the conventional code. */
function cancelled(): CollectedInputs {
  console.log('Cancelled.');
  return { ok: false, exitCode: MODE_EXIT_CANCELLED };
}
