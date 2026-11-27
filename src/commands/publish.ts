import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { confirm, isCancel, select } from '@clack/prompts';
import { parseCollectionManifest, type CollectionManifest } from '../core/manifest.js';
import { computeManifestHash } from '../core/hash.js';
import { chooseRemoteName } from '../core/remote.js';
import { ensureReleaseTag } from '../core/release.js';
import { excludeCredentialFiles, scanFilesForSecrets } from '../core/secrets.js';
import { displaySource, githubOwnerRepo } from '../core/source.js';
import type { InstallScope } from '../core/scope.js';
import {
  buildPublishedManifest,
  chooseMemberParent,
  copySkillFolder,
  diffSkillFolders,
  findMemberFolders,
  isOwnMember,
} from '../core/publish-plan.js';
import { collectPublishTargets, type PublishTarget } from '../core/publish-targets.js';
import { withProgress } from './progress.js';
import { pickSkills } from './pick-skills.js';
import { listInstalledSkills, type ListedSkill } from '../skills/index.js';
import {
  cloneRepo,
  gh,
  git,
  hasCommits,
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

/** Usage text for `kitcrate publish`. */
export const PUBLISH_USAGE = `Usage: kitcrate publish [name]

Publish a change to a collection that already exists. kitcrate creates a
collection the first time; this publishes the skills added since.

Ask which collection to publish, offer the installed skills it does not list
yet, copy the chosen skills and any local change to its existing members into
a temporary clone of its repository, bump the patch version, then commit, tag,
and push. A collection you cannot push to is published to a new repository
under your own GitHub account.

Arguments:
  [name]   Publish this collection without asking which one

Options:
  --yes     Non-interactive use: take every new skill, publish private
  --json    Machine-readable output
  --debug   Include stack traces on errors`;

/** A prompt was cancelled: clack reports it with a distinct symbol rather than by throwing. */
const EXIT_CANCELLED = 130;

/** The tag kitcrate makes for a release, and the commit subject that marks it as kitcrate's. */
const RELEASE_TAG = 'v';
const COMMIT_SUBJECT = 'chore: collection ';

/** An installed skill that is not a member of the collection yet. */
interface CandidateSkill {
  readonly name: string;
  /** The installed copy's folder. Absent when the adapter could not name it. */
  readonly path?: string;
}

/** A member the local copy of which differs from the collection's. */
interface ChangedMember {
  readonly skill: string;
  /** The member's folder in the clone. */
  readonly repoPath: string;
  /** The files that differ, relative to the skill folder. */
  readonly changedFiles: readonly string[];
  /** The installed copy's folder. Absent when the adapter could not name it. */
  readonly localPath?: string;
}

/** A difference that cannot be published into this collection, and why. */
interface LeftAlone {
  readonly skill: string;
  readonly reason: string;
}

/** Where the publish went. */
type Destination =
  | { readonly kind: 'same-repository'; readonly repo: string; readonly url: string }
  | { readonly kind: 'new-repository'; readonly repo: string; readonly remote: string };

/** Handle the `kitcrate publish [name]` command. */
export async function publishCommand(argv: string[], options: CommandOptions): Promise<number> {
  const { yes, json } = options;
  const cwd = process.cwd();
  const nonInteractive = yes || json || !isInteractive();
  let cloneDir: string | undefined;

  try {
    // 1. Which collection. Reading the global skills is the slow half, so it
    // gets a spinner.
    const targets = await withProgress(json, 'Finding collections to publish', () =>
      collectPublishTargets(cwd)
    );
    const chosen = await chooseTarget(targets, argv[0], nonInteractive, json);
    if (!chosen.ok) return chosen.exitCode;

    // 2. Clone the collection, and read the manifest from the clone.
    cloneDir = await mkdtemp(join(tmpdir(), 'kitcrate-publish-'));
    const repoRoot = cloneDir;
    const originUrl = cloneOrigin(chosen.target.source);
    await cloneRepo(originUrl, repoRoot);
    const manifestPath = join(repoRoot, 'collection.json');
    const originalManifestJson = await readText(manifestPath, 'collection.json');
    const original = parseCollectionManifest(JSON.parse(originalManifestJson));

    // A collection found through the global skills is only named here, once its
    // manifest has been read.
    const name = original.name;
    if (!isValidCollectionName(name)) {
      console.error(`The collection's collection.json names "${name}", which is not a valid name.`);
      return 1;
    }

    // The manifest a clone's root holds is the default branch's. A lockfile
    // entry names a ref, and a changed version could collide with a tag that
    // ref already made, so publish on top of the ref the collection is on.
    await switchToCollectionRef(repoRoot, chosen.target);

    // 3. The local skills, in the collection's own scope.
    const installed = await listInstalledSkills({
      cwd,
      scope: chosen.target.scope satisfies InstallScope,
    });
    const memberFolders = await findMemberFolders(repoRoot, original.skills);
    const { candidates, changed, leftAlone } = await survey({
      repoRoot,
      manifest: original,
      memberFolders,
      installed,
    });

    // 4. Which new skills to add.
    const selected = await chooseNewSkills(candidates, nonInteractive, json);
    if (selected === null) {
      console.log('Cancelled.');
      return EXIT_CANCELLED;
    }

    // 5. Copy into the clone. Never the user's working tree.
    const added = await copyNewSkills({
      repoRoot,
      manifest: original,
      memberFolders,
      candidates,
      selected,
    });
    const updated = await copyChangedMembers(repoRoot, changed);

    // 6. Rewrite collection.json with the added members and the new version.
    // The local copy of a changed member always differs, because copyChangedMembers
    // only returns a member whose folder was replaced.
    const changes = added.length + updated.length;

    // Nothing new and nothing changed: there is no release to make, so no
    // version is raised and nothing is pushed.
    if (changes === 0) {
      const unchanged = {
        collection: name,
        scope: chosen.target.scope,
        source: chosen.target.source,
        version: original.version,
        published: false,
        destination: null,
        added: [],
        updated: [],
        leftAlone,
        members: original.skills.map((member) => ({
          name: member.skill,
          source: member.source,
        })),
      };
      if (json) {
        console.log(JSON.stringify(unchanged, null, 2));
        return 0;
      }
      console.log(`Nothing to publish: ${name} v${original.version} is up to date.`);
      for (const item of leftAlone) {
        console.log(`  ${item.skill}: left alone, ${item.reason}`);
      }
      return 0;
    }

    const published = buildPublishedManifest(
      original,
      added.map((entry) => entry.skill)
    );
    const publishedJson = JSON.stringify(published, null, 2) + '\n';
    const manifestHash = computeManifestHash(publishedJson);
    await writeFile(manifestPath, publishedJson, 'utf8');

    for (const item of leftAlone) {
      console.error(`  ${item.skill}: left alone, ${item.reason}`);
    }

    // 7. Commit and push.
    const tagged = await commitAndTag(repoRoot, name, published.version);
    if (!tagged.ok) return 1;

    const destination = await push({
      repoRoot,
      target: chosen.target,
      name,
      tag: `${RELEASE_TAG}${published.version}`,
      nonInteractive,
    });
    if (!destination.ok) return 1;

    // 8. Report.
    const result = {
      collection: name,
      scope: chosen.target.scope,
      source: chosen.target.source,
      version: published.version,
      published: true,
      commit: tagged.commit,
      tag: `${RELEASE_TAG}${published.version}`,
      destination: destination.destination,
      added: added.map((entry) => ({ name: entry.skill, path: entry.path, files: entry.files })),
      updated: updated.map((entry) => ({ name: entry.name, files: entry.changedFiles })),
      leftAlone,
      members: published.skills.map((member) => ({
        name: member.skill,
        source: member.source,
      })),
      manifestHash,
    };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    report(result);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to publish: ${message}`);
    return 1;
  } finally {
    if (cloneDir !== undefined) await rm(cloneDir, { recursive: true, force: true });
  }
}

/** Either the target to publish or an exit code, so a cancellation cannot look like success. */
type ChosenTarget =
  | { readonly ok: true; readonly target: PublishTarget }
  | { readonly ok: false; readonly exitCode: number };

/** Pick the collection to publish: the argument when given, otherwise a prompt. */
async function chooseTarget(
  targets: readonly PublishTarget[],
  argument: string | undefined,
  nonInteractive: boolean,
  json: boolean
): Promise<ChosenTarget> {
  if (targets.length === 0) {
    console.error('No collections to publish.');
    console.error(
      'Publishing updates a collection that already exists. Install one with `kitcrate add <source>`, or publish a new one with `kitcrate create`.'
    );
    return { ok: false, exitCode: 1 };
  }

  const matches = (target: PublishTarget, name: string): boolean => {
    const repo = githubOwnerRepo(target.source);
    return target.name === name || target.source === name || repo === name;
  };

  if (argument !== undefined) {
    const found = targets.filter((target) => matches(target, argument));
    if (found.length === 0) {
      console.error(`No installed collection named "${argument}".`);
      console.error(
        `Known collections: ${targets.map((target) => targetLabel(target)).join(', ')}`
      );
      return { ok: false, exitCode: 1 };
    }
    if (found.length > 1) {
      console.error(
        `More than one installed collection matches "${argument}": ${found.map((target) => targetLabel(target)).join(', ')}.`
      );
      console.error('Publish one from its directory, or pass the name it is recorded under.');
      return { ok: false, exitCode: 1 };
    }
    const [only] = found;
    if (only === undefined) return { ok: false, exitCode: 1 };
    return { ok: true, target: only };
  }

  if (nonInteractive || targets.length === 1) {
    const [only] = targets;
    if (only === undefined) return { ok: false, exitCode: 1 };
    say(json, `Non-interactive: publishing "${targetLabel(only)}".`);
    return { ok: true, target: only };
  }

  const answer = await select({
    message: 'Which collection do you want to publish?',
    options: targets.map((target, index) => ({
      // The index, because two collections may record the same source.
      value: String(index),
      label: targetLabel(target),
      hint: targetHint(target),
    })),
  });
  if (isCancel(answer)) return { ok: false, exitCode: EXIT_CANCELLED };

  const picked = targets[Number.parseInt(answer, 10)];
  if (picked === undefined) return { ok: false, exitCode: 1 };
  return { ok: true, target: picked };
}

/**
 * How a target reads in a prompt: the name the lockfile records, and the
 * source in brackets, so two collections with one name are still told apart.
 * A collection found through the global skills has no name of its own yet, so
 * it is labelled by its repository until its manifest is read.
 */
function targetLabel(target: PublishTarget): string {
  if (target.origin === 'lockfile' && target.name === target.source) return target.source;
  return target.origin === 'lockfile'
    ? `${target.name} (${displaySource(target.source)})`
    : displaySource(target.source);
}

/** The hint beside a target: which scope it is in, so a global one is not mistaken for a project one. */
function targetHint(target: PublishTarget): string {
  return target.scope === 'global' ? 'global' : 'project';
}

/**
 * Put the clone on the ref the lockfile entry names, as a local branch, so the
 * manifest published is the one on top of the release consumers are on and the
 * push has a branch to send.
 *
 * A ref that names a tag or a commit rather than a branch is not a place to
 * commit, so the clone stays on the default branch it arrived on; the copy it
 * holds is the default branch's either way.
 */
async function switchToCollectionRef(repoRoot: string, target: PublishTarget): Promise<void> {
  if (target.origin !== 'lockfile') return;
  const ref = target.ref;
  if (ref === undefined || ref === '') return;

  const onBranch = await git(['checkout', '-B', ref, '--no-track', `origin/${ref}`], repoRoot);
  if (onBranch.code === 0) return;

  // The ref may be the branch the clone is already on, in which case there is
  // no `origin/<ref>` to start from.
  const existing = await git(['checkout', ref], repoRoot);
  if (existing.code !== 0) return;
}

/** What the survey of one collection found. */
interface Survey {
  readonly candidates: readonly CandidateSkill[];
  readonly changed: readonly ChangedMember[];
  readonly leftAlone: readonly LeftAlone[];
}

/**
 * Compare the installed skills with the collection: which installed skills it
 * does not list yet, and which of its own members differ from the local copy.
 *
 * A member whose source is another repository is compared too, but only so the
 * difference can be reported: its folder in this repository is not what
 * installers fetch, so copying into it would change nothing for them.
 */
async function survey(context: {
  readonly repoRoot: string;
  readonly manifest: CollectionManifest;
  readonly memberFolders: ReadonlyMap<string, string>;
  readonly installed: readonly ListedSkill[];
}): Promise<Survey> {
  const { repoRoot, manifest, memberFolders, installed } = context;
  const members = new Set(manifest.skills.map((member) => member.skill));

  // One installed copy per name. A skill can be installed for several agents,
  // but they share a folder; the copy with a path is the one that can be read.
  const localByName = new Map<string, ListedSkill>();
  for (const skill of installed) {
    const existing = localByName.get(skill.name);
    if (existing === undefined || (existing.path === undefined && skill.path !== undefined)) {
      localByName.set(skill.name, skill);
    }
  }

  const candidates: CandidateSkill[] = [];
  const leftAlone: LeftAlone[] = [];
  for (const [name, skill] of [...localByName].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.has(name)) continue;
    if (skill.path === undefined) {
      leftAlone.push({
        skill: name,
        reason: 'it is installed but no folder was found for it, so there is nothing to copy',
      });
      continue;
    }
    candidates.push({ name, path: skill.path });
  }

  const changed: ChangedMember[] = [];
  for (const member of manifest.skills) {
    const repoPath = memberFolders.get(member.skill);
    const local = localByName.get(member.skill);
    if (repoPath === undefined || local === undefined) continue;

    const diff = await diffSkillFolders(local.path ?? '', join(repoRoot, repoPath));
    if (!diff.changed) continue;

    if (!isOwnMember(member)) {
      leftAlone.push({
        skill: member.skill,
        reason:
          `its manifest source is ${member.source}, so consumers install it from that repository. ` +
          `Commit the change there (${describeChangeLocation(member.skill, diff.changedFiles)}); ` +
          'changing its folder in this collection would change nothing for them',
      });
      continue;
    }

    changed.push({
      skill: member.skill,
      repoPath,
      changedFiles: diff.changedFiles,
      ...(local.path !== undefined && { localPath: local.path }),
    });
  }

  return { candidates, changed, leftAlone };
}

/** Where a change to a member from another repository belongs. */
function describeChangeLocation(skill: string, changedFiles: readonly string[]): string {
  const files = changedFiles.length === 1 ? changedFiles[0] : `${changedFiles.length} files`;
  return `${skill}/${files} in that repository`;
}

/** Ask which new skills to add. Null when the prompt was cancelled. */
async function chooseNewSkills(
  candidates: readonly CandidateSkill[],
  nonInteractive: boolean,
  json: boolean
): Promise<string[] | null> {
  if (candidates.length === 0) return [];
  if (nonInteractive) {
    say(json, `Non-interactive: adding every new skill (${candidates.length}).`);
    return candidates.map((skill) => skill.name);
  }

  const picked = await pickSkills(
    'Select skills to add to the collection',
    candidates.map((skill) => ({ value: skill.name, label: skill.name }))
  );
  return picked;
}

/** One skill copied into the collection. */
interface AddedSkill {
  readonly skill: string;
  /** The skill's folder in the repository, relative to its root. */
  readonly path: string;
  /** The files copied, relative to the skill folder. */
  readonly files: readonly string[];
}

/**
 * Copy the chosen skills into the clone, under the folder the collection's own
 * members already use.
 */
async function copyNewSkills(context: {
  readonly repoRoot: string;
  readonly manifest: CollectionManifest;
  readonly memberFolders: ReadonlyMap<string, string>;
  readonly candidates: readonly CandidateSkill[];
  readonly selected: readonly string[];
}): Promise<AddedSkill[]> {
  const { repoRoot, manifest, memberFolders, candidates, selected } = context;
  const wanted = new Set(selected);
  const parent = await chooseMemberParent(
    repoRoot,
    manifest.skills.map((member) => {
      const repoPath = memberFolders.get(member.skill);
      return repoPath === undefined ? { ...member } : { ...member, repoPath };
    })
  );

  const added: AddedSkill[] = [];
  for (const candidate of candidates) {
    if (!wanted.has(candidate.name) || candidate.path === undefined) continue;
    const path = parent === '' ? candidate.name : `${parent}/${candidate.name}`;
    const files = await copySkillFolder(candidate.path, join(repoRoot, ...path.split('/')));
    added.push({ skill: candidate.name, path, files: files.map((file) => file.path) });
  }
  return added;
}

/** A member whose local copy replaced the collection's. */
interface UpdatedMember {
  readonly name: string;
  readonly path: string;
  readonly changedFiles: readonly string[];
}

/** Copy the local version of every changed member over the copy in the clone. */
async function copyChangedMembers(
  repoRoot: string,
  changed: readonly ChangedMember[]
): Promise<readonly UpdatedMember[]> {
  const updated: UpdatedMember[] = [];
  for (const member of changed) {
    // An installed skill with no folder cannot be read, so there is nothing to
    // copy over the collection's copy.
    if (member.localPath === undefined) continue;
    await copySkillFolder(member.localPath, join(repoRoot, ...member.repoPath.split('/')));
    updated.push({ name: member.skill, path: member.repoPath, changedFiles: member.changedFiles });
  }
  return updated;
}

/** The commit this run made, once it exists. */
type Committed = { readonly ok: true; readonly commit: string } | { readonly ok: false };

/** Stage exactly the collection's files, gate them, then commit and tag the new version. */
async function commitAndTag(repoRoot: string, name: string, version: string): Promise<Committed> {
  // The commit takes the whole index, so anything already staged would be
  // published too. The clone is fresh, so this only guards against a weird one.
  if (!(await hasCommits(repoRoot))) {
    console.error('The collection repository has no commits to publish on top of.');
    return { ok: false };
  }
  const preStaged = await listStagedChanges(repoRoot);
  if (preStaged.length > 0) {
    console.error('The clone already has staged changes, which kitcrate will not publish:');
    for (const path of preStaged) console.error(`  - ${path}`);
    return { ok: false };
  }

  // Stage explicitly. Never `git add .`.
  const changedFiles = (await git(['diff', '--name-only', '-z', '--', '.'], repoRoot)).stdout
    .split('\0')
    .filter(Boolean);
  const untracked = (
    await git(['ls-files', '--others', '--exclude-standard', '-z'], repoRoot)
  ).stdout
    .split('\0')
    .filter(Boolean);
  await stagePaths(repoRoot, ['collection.json', ...changedFiles, ...untracked]);

  // The publish gate: credential files stay on disk but are never pushed, and
  // secret findings are reported without blocking the publish.
  const excluded = await excludeCredentialFiles(repoRoot);
  if (excluded.length > 0) {
    console.error(`Excluded ${excluded.length} credential file(s) from the publish:`);
    for (const path of excluded) console.error(`  - ${path}`);
  }

  const tracked = await listTrackedFiles(repoRoot);
  const findings = await scanFilesForSecrets(repoRoot, tracked);
  if (!findings.clean) {
    console.error(
      `Secret scan found ${findings.findings.length} potential secret(s) in files that would be pushed:`
    );
    for (const finding of findings.findings) {
      console.error(`  ! ${finding.path}: ${finding.message}`);
    }
    console.error('Publishing anyway: secret findings never block a publish.');
  }

  const staged = await listStagedChanges(repoRoot);
  if (staged.length === 0) {
    console.error('Nothing was left to commit after the publish gate, so nothing was published.');
    return { ok: false };
  }

  const commit = await git(['commit', '-m', `${COMMIT_SUBJECT}${name} v${version}`], repoRoot);
  if (commit.code !== 0) {
    const detail = commit.stderr.trim() || commit.stdout.trim();
    console.error(`Failed to commit: ${detail}`);
    return { ok: false };
  }
  const head = (await git(['rev-parse', 'HEAD'], repoRoot)).stdout.trim();

  const tag = `${RELEASE_TAG}${version}`;
  const release = await ensureReleaseTag(repoRoot, tag);
  if (!release.ok) {
    console.error(release.reason);
    return { ok: false };
  }
  return { ok: true, commit: head };
}

/** Where the publish went, or that it stopped. */
type Pushed = { readonly ok: true; readonly destination: Destination } | { readonly ok: false };

/**
 * Push the new commit: to the collection's own repository when this user may
 * push there, otherwise to a new repository under the user's own account.
 */
async function push(context: {
  readonly repoRoot: string;
  readonly target: PublishTarget;
  readonly name: string;
  readonly tag: string;
  readonly nonInteractive: boolean;
}): Promise<Pushed> {
  const { repoRoot, target, name, tag, nonInteractive } = context;
  const repo = githubOwnerRepo(target.source);

  if (repo !== null && (await canPush(repo))) {
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).stdout.trim();
    return pushToOrigin(repoRoot, branch, tag, repo);
  }

  // Either this user cannot push to the collection's repository, or the source
  // is not a GitHub repository at all. Either way the change goes to a new
  // repository under the user's own account, private unless they say otherwise.
  return createRepository(repoRoot, name, nonInteractive);
}

/**
 * Push the current branch and its release tag to the clone's origin, which is
 * the collection's own repository.
 *
 * The tag is named outright rather than left to `--follow-tags`, which sends
 * only annotated tags; the release tag is lightweight, so it would otherwise
 * stay on this machine and `kitcrate add <source>@<tag>` would fail.
 */
async function pushToOrigin(
  repoRoot: string,
  branch: string,
  tag: string,
  repo: string
): Promise<Pushed> {
  const pushed = await git(['push', 'origin', branch], repoRoot);
  if (pushed.code !== 0) {
    const detail = pushed.stderr.trim() || pushed.stdout.trim();
    console.error(`Failed to push to ${repo}: ${detail}`);
    return { ok: false };
  }

  const tagPushed = await git(['push', 'origin', `refs/tags/${tag}`], repoRoot);
  if (tagPushed.code !== 0) {
    const detail = tagPushed.stderr.trim() || tagPushed.stdout.trim();
    console.error(
      `The branch was pushed but the release tag ${tag} was not: ${detail}\n` +
        `Push it with \`git push origin refs/tags/${tag}\` from a clone.`
    );
  }

  const url = (await git(['remote', 'get-url', 'origin'], repoRoot)).stdout.trim();
  return { ok: true, destination: { kind: 'same-repository', repo, url } };
}

/** Publish to a new repository under the user's own GitHub account. */
async function createRepository(
  repoRoot: string,
  name: string,
  nonInteractive: boolean
): Promise<Pushed> {
  const remoteChoice = chooseRemoteName(await listRemotes(repoRoot));
  if (!remoteChoice.ok) {
    console.error(remoteChoice.reason);
    return { ok: false };
  }

  const visibility = await chooseVisibility(name, nonInteractive);
  if (visibility === null) {
    console.error('Publication cancelled: public visibility was not confirmed.');
    return { ok: false };
  }

  const visibilityFlag = visibility === 'public' ? '--public' : '--private';
  const created = await gh(
    [
      'repo',
      'create',
      name,
      visibilityFlag,
      '--source',
      repoRoot,
      '--remote',
      remoteChoice.name,
      '--push',
    ],
    repoRoot
  );
  if (created.code !== 0) {
    const detail = created.stderr.trim() || created.stdout.trim();
    console.error(`Failed to create GitHub repo: ${detail}`);
    return { ok: false };
  }

  // `gh repo create --push` pushes the branch; the release tag may or may not
  // travel with it, so send it as well. That the repository exists is what a
  // failure here would not change, so it is reported rather than failing.
  const pushedTag = await git(['push', remoteChoice.name, '--tags'], repoRoot);
  if (pushedTag.code !== 0) {
    const detail = pushedTag.stderr.trim() || pushedTag.stdout.trim();
    console.error(
      `The repository was created but the release tag was not pushed: ${detail}\n` +
        `Push it with \`git push ${remoteChoice.name} --tags\` from a clone.`
    );
  }

  const owner = await currentUser(repoRoot);
  const repo = owner === null ? name : `${owner}/${name}`;
  return {
    ok: true,
    destination: { kind: 'new-repository', repo, remote: remoteChoice.name },
  };
}

/** Private unless the user explicitly confirms public, the way `create` asks. */
async function chooseVisibility(
  name: string,
  nonInteractive: boolean
): Promise<'private' | 'public' | null> {
  if (nonInteractive) return 'private';
  const answer = await confirm({
    message: `Publish "${name}" as a new PRIVATE GitHub repository?`,
    initialValue: true,
  });
  if (isCancel(answer)) return null;
  // A public repository needs an explicit, separate confirmation.
  if (answer) return 'private';

  const isPublic = await confirm({
    message: `Publish "${name}" as a PUBLIC GitHub repository? Anyone will be able to read it.`,
    initialValue: false,
  });
  if (isCancel(isPublic)) return null;
  return isPublic ? 'public' : null;
}

/** True when this user may push to a GitHub repository. */
async function canPush(repo: string): Promise<boolean> {
  const result = await gh(['api', `repos/${repo}`, '--jq', '.permissions.push']);
  if (result.code !== 0) return false;
  return result.stdout.trim() === 'true';
}

/** The login of the GitHub user `gh` is authenticated as, or null. */
async function currentUser(cwd: string): Promise<string | null> {
  const result = await gh(['api', 'user', '--jq', '.login'], cwd);
  const login = result.stdout.trim();
  return result.code === 0 && login !== '' ? login : null;
}

/** The URL to clone a collection's source from. */
function cloneOrigin(source: string): string {
  const repo = githubOwnerRepo(source);
  if (repo !== null) return `https://github.com/${repo}.git`;
  return source;
}

/** Read a text file, naming it in the error when it cannot be read. */
async function readText(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`This repository has no ${label}, so it is not a collection.`);
    }
    throw error;
  }
}

/** True when an error is a file that is not there. */
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Prompting needs a real terminal on both ends; piping either one makes clack unusable. */
function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** The collection name convention, so a manifest read from the network is checked here too. */
function isValidCollectionName(name: string): boolean {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name);
}

/** Print the human-readable report of a publish. */
function report(result: {
  readonly collection: string;
  readonly scope: PublishTarget['scope'];
  readonly version: string;
  readonly commit: string;
  readonly tag: string;
  readonly destination: Destination;
  readonly added: readonly { readonly name: string; readonly path: string }[];
  readonly updated: readonly { readonly name: string; readonly files: readonly string[] }[];
  readonly leftAlone: readonly LeftAlone[];
  readonly members: readonly { readonly name: string; readonly source: string }[];
}): void {
  const where =
    result.destination.kind === 'same-repository'
      ? result.destination.repo
      : `${result.destination.repo} (new repository, "${result.destination.remote}" remote)`;

  console.log(`\nCollection "${result.collection}" published (v${result.version}) to ${where}.`);
  console.log(`  scope: ${result.scope}`);
  console.log(`  commit: ${result.commit}`);
  console.log(`  tag: ${result.tag}`);

  if (result.added.length > 0) {
    console.log('  added:');
    for (const skill of result.added) console.log(`    + ${skill.name} (${skill.path})`);
  }
  if (result.updated.length > 0) {
    console.log('  updated:');
    for (const skill of result.updated)
      console.log(`    ~ ${skill.name} (${skill.files.length} file(s))`);
  }
  if (result.leftAlone.length > 0) {
    console.log('  left alone:');
    for (const item of result.leftAlone) console.log(`    - ${item.skill}: ${item.reason}`);
  }
  console.log('  members:');
  for (const member of result.members) {
    console.log(
      `    ${member.name}: from ${member.source === '.' ? 'this collection' : member.source}`
    );
  }
  console.log('\nInstall with:');
  console.log(`  kitcrate add github:${result.destination.repo}@${result.tag}`);
}
