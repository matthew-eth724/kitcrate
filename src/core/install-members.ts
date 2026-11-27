import type { InstallScope } from './scope.js';
import { planMemberInstalls, type InstallGroup } from './members.js';
import type { CollectionManifest } from './manifest.js';
import type { ResolvedManifest } from './resolve.js';
import { installCollectionSkills, type InstalledMember } from '../skills/index.js';

/** What one collection's install did. */
export interface MemberInstallResult {
  readonly installed: readonly InstalledMember[];
  /** Names that were filtered out and therefore never attempted. */
  readonly skipped: readonly string[];
}

/** How the members should be installed. */
export interface InstallMembersOptions {
  readonly scope: InstallScope;
  /** Only install these member names. Defaults to every member. */
  readonly only?: readonly string[];
  readonly cwd?: string;
}

/**
 * Install a collection's member skills from the sources its manifest names,
 * one call per source and ref. Every command that installs members goes through
 * here, so `add`, `install`, and `update` cannot disagree about where a member
 * comes from.
 *
 * Throws when a source cannot be expressed as a repository; the caller reports
 * it. Failure diagnoses are returned, not thrown, so the caller decides whether
 * to stop.
 */
export async function installMembers(
  resolved: ResolvedManifest,
  options: InstallMembersOptions
): Promise<MemberInstallResult> {
  const manifest: CollectionManifest = resolved.manifest;
  const wanted =
    options.only === undefined ? manifest.skills.map((member) => member.skill) : [...options.only];
  const requested = new Set(wanted);

  const groups: readonly InstallGroup[] = planMemberInstalls(manifest, {
    // The normalized source, without the ref the user wrote after it: the
    // `skills` package reads a trailing `@name` as a skill filter, so
    // `owner/repo@v1` would look for a skill called `v1`.
    source: resolved.url,
    ...(resolved.ref !== undefined && { ref: resolved.ref }),
  });

  const installed: InstalledMember[] = [];
  const attempted = new Set<string>();

  for (const group of groups) {
    const skills = group.skills.filter((skill) => requested.has(skill));
    if (skills.length === 0) continue;
    for (const skill of skills) attempted.add(skill);

    const result = await installCollectionSkills(group.source, {
      skills,
      scope: options.scope,
      mode: 'auto',
      ...(options.cwd !== undefined && { cwd: options.cwd }),
      ...(group.ref !== undefined && { ref: group.ref }),
    });
    installed.push(...result.installed);

    for (const failure of result.failed) {
      throw new MemberInstallError(failure.name, failure.message);
    }
  }

  return { installed, skipped: wanted.filter((skill) => !attempted.has(skill)) };
}

/** A member skill the `skills` package refused to install. */
export class MemberInstallError extends Error {
  constructor(
    readonly skill: string,
    readonly detail: string
  ) {
    super(`Failed to install skill "${skill}": ${detail}`);
    this.name = 'MemberInstallError';
  }
}
