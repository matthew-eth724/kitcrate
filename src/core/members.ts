import type { CollectionManifest } from './manifest.js';
import { githubOwnerRepo } from './source.js';

/** Member skills installed from one source at one ref, in one `skills` call. */
export interface InstallGroup {
  /** Source to install from: a collection's own source, or an `owner/repo`. */
  readonly source: string;
  /** Ref to install at. Absent means the source's default branch. */
  readonly ref?: string;
  /** Member skill names to install from that source. */
  readonly skills: readonly string[];
}

/** The resolved collection a member's source is relative to. */
export interface CollectionOrigin {
  /**
   * The collection's normalized source, without a ref. The `skills` package
   * reads a trailing `@name` in a source as a skill filter, so the ref travels
   * separately.
   */
  readonly source: string;
  /** The collection's own ref, for members that do not name one. */
  readonly ref?: string;
}

/** Where a member skill's own source came from. */
type MemberSource =
  /** The collection itself. */
  | { readonly kind: 'collection' }
  /** Another repository, named in the manifest as `owner/repo`. */
  | { readonly kind: 'own'; readonly repo: string }
  /** A source a manifest cannot carry, such as an absolute path. */
  | { readonly kind: 'unsupported' };

/**
 * Classify a manifest entry's `source`. A relative path means the collection's
 * own directory, which is what `kitcrate create` writes for a skill it cannot
 * attribute.
 */
function classifySource(source: string): MemberSource {
  const trimmed = source.trim();
  if (trimmed === '.') return { kind: 'collection' };

  // `github:owner/repo` names the same repository as `owner/repo`, and a hand
  // written manifest may use either. Normalizing here keeps one key per
  // repository, so the two forms group into a single install.
  const repo = githubOwnerRepo(trimmed);
  if (repo !== null) return { kind: 'own', repo };

  return { kind: 'unsupported' };
}

/**
 * Split a manifest's members into the install calls needed to honour their own
 * sources. Members sharing a source and a ref go in one call; a member with no
 * ref of its own is installed at the collection's ref, which is the ref the
 * collection's members were always installed at.
 *
 * A source a manifest cannot express stops the install rather than resolving
 * against a repository the manifest never named.
 */
export function planMemberInstalls(
  manifest: CollectionManifest,
  collection: CollectionOrigin
): readonly InstallGroup[] {
  const groups: InstallGroup[] = [];
  const byKey = new Map<string, { source: string; ref?: string; skills: string[] }>();

  for (const member of manifest.skills) {
    const kind = classifySource(member.source);
    if (kind.kind === 'unsupported') {
      throw new Error(
        `Skill "${member.skill}" names the source "${member.source}", which cannot be installed. ` +
          'Use owner/repo, or "." for the collection\'s own repository.'
      );
    }

    const fromCollection = kind.kind === 'collection';
    const source = fromCollection ? collection.source : kind.repo;
    const ref = member.ref ?? (fromCollection ? collection.ref : undefined);
    const key = `${source}\n${ref ?? ''}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.skills.push(member.skill);
      continue;
    }
    const group = { source, skills: [member.skill], ...(ref !== undefined && { ref }) };
    byKey.set(key, group);
    groups.push(group);
  }

  return groups;
}
