import { git, resolveTagCommit } from '../git/index.js';

/**
 * The subjects kitcrate writes on a collection's commits. They mark the commits
 * kitcrate made, so a release tag left on one of them is kitcrate's own to move
 * rather than something the author put there.
 *
 * `create` writes the first, when the collection is published for the first
 * time; `publish` writes the rest, for every change after that.
 */
export const COLLECTION_COMMIT_SUBJECTS = [
  'chore: initial collection ',
  'chore: collection ',
] as const;

/** True when a commit's subject marks it as one of kitcrate's own collection commits. */
export function isKitcrateSubject(subject: string): boolean {
  return COLLECTION_COMMIT_SUBJECTS.some((prefix) => subject.startsWith(prefix));
}

/** True when a commit is one of kitcrate's own collection commits. */
export async function isKitcrateCollectionCommit(cwd: string, commit: string): Promise<boolean> {
  const subject = (await git(['log', '-1', '--format=%s', commit], cwd)).stdout.trim();
  return isKitcrateSubject(subject);
}

/** What came of making room for a release tag. */
export type ReleaseTagResult =
  { readonly ok: true; readonly moved: boolean } | { readonly ok: false; readonly reason: string };

/**
 * Tag the commit this run made, `v<version>`.
 *
 * A tag that already points at `HEAD` is already right, and is left as it is. A
 * tag pointing at an older commit moves, but only when kitcrate made that
 * commit: a retry after a failed publish, or an earlier run of the same
 * command, can leave the tag behind. A tag pointing at a commit kitcrate did
 * not make is left alone and nothing is published, because it would otherwise
 * resolve to an older manifest and installers asking for the tag would get the
 * wrong release. That the tag is not at `HEAD` is the caller's business: this
 * only decides what to do about it.
 */
export async function ensureReleaseTag(cwd: string, tag: string): Promise<ReleaseTagResult> {
  const head = (await git(['rev-parse', 'HEAD'], cwd)).stdout.trim();
  const created = await git(['tag', tag], cwd);
  if (created.code === 0) return { ok: true, moved: false };
  if (head === '') {
    return { ok: false, reason: `Could not read the commit to tag ${tag} at.` };
  }

  const existing = await resolveTagCommit(cwd, tag);
  if (existing === head) return { ok: true, moved: false };
  if (existing === null || !(await isKitcrateCollectionCommit(cwd, existing))) {
    return {
      ok: false,
      reason:
        `The tag ${tag} already exists at ${existing ?? 'an unreadable commit'}, not at the commit this run made (${head}).\n` +
        `kitcrate did not make that tag, so it will not move it. Move it with \`git tag -f ${tag}\` once you are sure it is safe, then retry.`,
    };
  }

  const moved = await git(['tag', '-f', tag, head], cwd);
  if (moved.code !== 0) {
    const detail = moved.stderr.trim() || moved.stdout.trim();
    return { ok: false, reason: `Failed to move the tag ${tag}: ${detail}` };
  }
  return { ok: true, moved: true };
}
