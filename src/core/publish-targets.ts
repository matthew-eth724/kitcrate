import { readLockfile } from './lockfile.js';
import { githubOwnerRepo } from './source.js';
import { listInstalledSkills } from '../skills/index.js';

/** Where a collection's skills are installed. */
export type PublishScope = 'project' | 'global';

/** A collection that could be published, and where it was found. */
export interface PublishTarget {
  /** The collection's name when it is known; otherwise its repository. */
  readonly name: string;
  /** The collection's source, as recorded ('github:owner/repo', '/local/path', ...). */
  readonly source: string;
  readonly scope: PublishScope;
  /** Where the candidate came from. */
  readonly origin: 'lockfile' | 'global-skills';
}

/**
 * The collections that could be published from this project and this machine.
 *
 * Two places record one. `kitcrate-lock.json` names every collection the
 * project installed, and says which scope each one's skills landed in. The
 * global skills lockfile names the repository each globally installed skill
 * came from, and each distinct repository among them is a collection that was
 * installed globally: a global collection has no lockfile of its own, because
 * `kitcrate-lock.json` always lives in the project that asked for it.
 *
 * A collection found both ways is listed once, under its lockfile entry, which
 * carries the name. Reading the global scope is the expensive half, so it is
 * read only when a candidate could come from there or the caller needs the
 * sources anyway; here it is always read, which the command shows a spinner
 * for.
 */
export async function collectPublishTargets(cwd: string): Promise<PublishTarget[]> {
  const lockfile = await readLockfile(cwd);
  const targets: PublishTarget[] = Object.entries(lockfile.collections).map(([name, entry]) => ({
    name,
    source: entry.source,
    scope: entry.scope,
    origin: 'lockfile',
  }));

  const installed = await listInstalledSkills({ cwd, scope: 'global' });

  // A global skill's source is the repository it was installed from, in
  // whichever form the `skills` lock file recorded it.
  const seen = new Set(targets.flatMap((target) => sourceKeys(target.source)));
  for (const skill of installed) {
    if (skill.source === undefined) continue;
    const keys = sourceKeys(skill.source);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    targets.push({
      name: githubOwnerRepo(skill.source) ?? skill.source,
      source: skill.source,
      scope: 'global',
      origin: 'global-skills',
    });
  }

  return targets;
}

/**
 * The forms two sources share when they name the same repository, so a
 * collection already found through the lockfile is not listed again because
 * the global skills happened to record it as a clone URL.
 */
function sourceKeys(source: string): string[] {
  const repo = githubOwnerRepo(source);
  return repo === null ? [source] : [source, repo, `github:${repo}`];
}
