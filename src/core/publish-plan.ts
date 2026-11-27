import { readdir, readFile, stat } from 'fs/promises';
import { dirname, join, relative, sep } from 'path';
import { parseCollectionManifest, type CollectionManifest } from './manifest.js';
import { isCredentialFileName } from './secrets.js';

/** How much a skill's local folder differs from the copy in the collection. */
export interface SkillFolderDiff {
  /** True when the two folders hold different files or different contents. */
  readonly changed: boolean;
  /** The files that differ, relative to the skill folder. */
  readonly changedFiles: readonly string[];
}

/** A member of a collection, and where its folder sits in the collection's repository. */
export interface CollectionMember {
  readonly skill: string;
  /** The member's source as recorded in the manifest. */
  readonly source: string;
  /** The member's folder inside the collection repository, relative to its root. */
  readonly repoPath?: string;
}

/** Directories never compared or copied: a git repository is not skill content. */
const IGNORED_DIRECTORIES = new Set(['.git']);

/** The member source that means "this collection": where a copied skill goes. */
const OWN_COLLECTION_SOURCE = '.';

/** The folder a published skill gets when the collection gives no better answer. */
const DEFAULT_SKILL_PARENT = 'skills';

/**
 * Compare two skill folders file by file. A file counts as changed when it is
 * present on only one side or its bytes differ, so a folder that was edited,
 * added to, or trimmed is all reported the same way.
 *
 * A folder that does not exist on one side is compared as empty rather than
 * throwing: a member the clone has lost is a change, not an error.
 */
export async function diffSkillFolders(
  localDir: string,
  repoDir: string
): Promise<SkillFolderDiff> {
  const local = await listFolderFiles(localDir);
  const repo = await listFolderFiles(repoDir);
  const names = [...new Set([...local.keys(), ...repo.keys()])].sort();

  const changedFiles: string[] = [];
  for (const name of names) {
    const localFile = local.get(name);
    const repoFile = repo.get(name);
    if (localFile === undefined || repoFile === undefined) {
      changedFiles.push(name);
      continue;
    }
    if (!(await sameContents(localFile, repoFile))) changedFiles.push(name);
  }

  return { changed: changedFiles.length > 0, changedFiles };
}

/** Every file under a folder, keyed by its `/`-separated path relative to the folder. */
async function listFolderFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  await walk(root, root, files);
  return files;
}

async function walk(root: string, dir: string, files: Map<string, string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      await walk(root, full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    files.set(relative(root, full).split(sep).join('/'), full);
  }
}

async function sameContents(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([readFile(a), readFile(b)]);
  return left.equals(right);
}

/**
 * The folder each member sits in, inside the collection's repository, keyed by
 * skill name.
 *
 * A member is found by its `SKILL.md` frontmatter rather than its folder name:
 * a skill may live in a folder with a different name, and the manifest names
 * the skill, not its path. Only a member the collection carries itself
 * (`source: "."`) is searched for, because another repository's member has no
 * folder here to find.
 */
export async function findMemberFolders(
  repoRoot: string,
  members: readonly CollectionMember[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  // A caller that already knows a member's folder saves the search for it.
  const wanted = new Set<string>();
  for (const member of members) {
    if (!isOwnMember(member)) continue;
    if (member.repoPath === undefined) wanted.add(member.skill);
    else found.set(member.skill, member.repoPath);
  }
  if (wanted.size === 0) return found;

  for (const folder of await listSkillFolders(repoRoot)) {
    if (found.size === wanted.size) break;
    const name = await readSkillName(join(repoRoot, folder));
    if (name === null || !wanted.has(name) || found.has(name)) continue;
    found.set(name, folder);
  }

  return found;
}

/** True when the member's source means the collection's own repository. */
export function isOwnMember(member: CollectionMember): boolean {
  return member.source.trim() === OWN_COLLECTION_SOURCE;
}

/**
 * Every folder under the repository root that holds a `SKILL.md`, relative to
 * the root and `/`-separated, sorted so the search is deterministic.
 */
async function listSkillFolders(repoRoot: string): Promise<string[]> {
  const folders: string[] = [];

  async function collect(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await collect(full);
        continue;
      }
      if (entry.name !== 'SKILL.md') continue;
      // A SKILL.md at the repository root would make the whole repository the
      // skill, which is not a folder to copy into.
      const folder = relative(repoRoot, dir);
      if (folder !== '') folders.push(folder.split(sep).join('/'));
    }
  }

  await collect(repoRoot);
  return folders.sort();
}

/** The `name` a skill's SKILL.md declares, or null when it cannot be read. */
async function readSkillName(skillDir: string): Promise<string | null> {
  let contents: string;
  try {
    contents = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match?.[1] === undefined) return null;
  const name = match[1].match(/^name:\s*(.+)$/m);
  return name?.[1] === undefined ? null : name[1].trim().replace(/^['"]|['"]$/g, '');
}

/**
 * The directory a newly published skill's folder goes in, relative to the
 * repository root: the parent the collection's own members already share, or
 * `skills` when they share none or the collection carries none yet.
 *
 * A member from another repository has no folder here, so it says nothing
 * about this collection's layout and is ignored.
 */
export async function chooseMemberParent(
  repoRoot: string,
  members: readonly CollectionMember[]
): Promise<string> {
  const parents = new Set(
    members
      .filter((member) => isOwnMember(member) && member.repoPath !== undefined)
      .map((member) => {
        const parent = dirname(member.repoPath ?? '');
        return parent === '.' ? '' : parent.split(sep).join('/');
      })
      // Sorted so the single element, when there is one, is stable.
      .sort()
  );

  if (parents.size !== 1) return DEFAULT_SKILL_PARENT;
  const parent = [...parents][0] ?? '';
  // A member whose folder sits at the repository root leaves no parent to name.
  if (parent === '') return DEFAULT_SKILL_PARENT;

  return (await isDirectory(join(repoRoot, parent))) ? parent : DEFAULT_SKILL_PARENT;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Raise a semver version's patch number by one: `0.1.0` becomes `0.1.1`. A
 * pre-release suffix is dropped, because a published change supersedes it.
 */
export function bumpPatchVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Cannot bump "${version}": expected a semver version such as 0.1.0.`);
  }
  return `${match[1]}.${match[2]}.${Number.parseInt(match[3], 10) + 1}`;
}

/**
 * The manifest to publish: the added skills become members of this collection
 * (`source: "."`), the existing members keep their own sources, and the version
 * gets a patch bump.
 *
 * A skill that is already a member is left where it is, so adding one by hand
 * and publishing it again does not duplicate it. The result is validated
 * before it is returned, so a manifest kitcrate cannot publish stops here.
 */
export function buildPublishedManifest(
  manifest: CollectionManifest,
  added: readonly string[]
): CollectionManifest {
  const existing = new Set(manifest.skills.map((member) => member.skill));
  const newMembers = [...new Set(added)]
    .filter((skill) => !existing.has(skill))
    .map((skill) => ({ source: OWN_COLLECTION_SOURCE, skill }));

  return parseCollectionManifest({
    name: manifest.name,
    version: bumpPatchVersion(manifest.version),
    description: manifest.description,
    skills: [...manifest.skills, ...newMembers],
  });
}

/**
 * True when a file may be copied into a collection: credential files never
 * travel, and `.env.example` is a template rather than a credential, so it
 * does.
 */
export function isCopyableFile(relativePath: string): boolean {
  const name = relativePath.split('/').pop() ?? relativePath;
  return !isCredentialFileName(name);
}
