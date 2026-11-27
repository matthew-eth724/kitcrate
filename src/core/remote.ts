/**
 * Remote names kitcrate publishes under, in order of preference. `origin` is
 * what `gh repo create` would pick on its own, but `gh` refuses to add it when
 * the repository already has one, so the next free name is used instead.
 */
export const REMOTE_NAME_PREFERENCES = ['origin', 'github'] as const;

/** Result of choosing a remote name for the new repository. */
export type RemoteName =
  { readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: string };

/**
 * Pick the name for the new repository's remote from the names already taken.
 * Only a free name works, because `gh` cannot add a remote that exists.
 */
export function chooseRemoteName(taken: readonly string[]): RemoteName {
  const takenNames = new Set(taken);
  const free = REMOTE_NAME_PREFERENCES.find((name) => !takenNames.has(name));
  if (free !== undefined) return { ok: true, name: free };

  return {
    ok: false,
    reason:
      `This repository already has remotes named ${REMOTE_NAME_PREFERENCES.map((name) => `"${name}"`).join(' and ')}, ` +
      'so there is no name left for the new repository. kitcrate never renames or removes ' +
      'your remotes. Remove one with `git remote remove <name>`, then run kitcrate create again.',
  };
}
