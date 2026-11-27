import { listInstalledSkills } from '../skills/index.js';
import { githubOwnerRepo } from './source.js';

/** A skill that could not be attributed to a repository, and why. */
export interface UnattributedSkill {
  readonly skill: string;
  readonly reason: string;
}

/** Where each selected skill came from. */
export interface MemberSources {
  /** Skill name to the `owner/repo` it came from. */
  readonly byName: ReadonlyMap<string, string>;
  /** Skills that could not be attributed, and why. */
  readonly unattributed: readonly UnattributedSkill[];
}

/**
 * The `owner/repo` each selected skill came from, read from the lock file the
 * `skills` CLI wrote when the author installed it.
 *
 * A skill kitcrate cannot attribute records `.`, which installs it from the
 * collection itself: the manifest schema refuses an absolute local path, so a
 * skill from a directory on this machine has nowhere else to go.
 */
export async function resolveMemberSources(
  skills: readonly { readonly name: string }[]
): Promise<MemberSources> {
  const byName = new Map<string, string>();
  const unattributed: UnattributedSkill[] = [];
  if (skills.length === 0) return { byName, unattributed };

  const installed = await listInstalledSkills({ scope: 'all' });

  for (const skill of skills) {
    const copies = installed.filter((copy) => copy.name === skill.name);
    const recorded = copies.flatMap((copy) => (copy.source === undefined ? [] : [copy.source]));
    const repos = new Set(
      copies.flatMap((copy) => (copy.source === undefined ? [] : [githubOwnerRepo(copy.source)]))
    );

    // A copy with no source is not a source that disagrees. It is a copy
    // kitcrate cannot attribute, and another copy of the same skill may name
    // the repository it came from.
    const named = [...repos].filter((repo): repo is string => repo !== null);
    if (named.length === 0) {
      unattributed.push({
        skill: skill.name,
        reason:
          recorded.length === 0
            ? 'skills-lock.json records no source'
            : `its source is ${[...new Set(recorded)].join(', ')}, not a GitHub repository`,
      });
      continue;
    }
    if (named.length > 1) {
      unattributed.push({
        skill: skill.name,
        reason: `its installed copies name different repositories: ${named.join(', ')}`,
      });
      continue;
    }
    byName.set(skill.name, named[0] as string);
  }

  return { byName, unattributed };
}
