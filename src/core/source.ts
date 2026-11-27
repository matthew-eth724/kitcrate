/**
 * The forms a skill source can take: `owner/repo`, `github:owner/repo`, a
 * GitHub URL over https or ssh, and a local path or other host's URL that has
 * no GitHub `owner/repo` equivalent at all.
 *
 * A collection manifest may only name a source as `owner/repo` (the schema
 * refuses a URL), so a source recorded in the skills lockfile has to be parsed
 * before it can be written into a manifest. The reverse direction is display:
 * the listing shows a source the way the manifest names it.
 */

/** A GitHub `owner/repo`. Neither segment may be a `.` or `..` path segment. */
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.\.?$)[A-Za-z0-9._-]+$/;

/** The hosts whose `owner/repo` a manifest can express. */
const GITHUB_HOST = 'github.com';

/** `git@github.com:owner/repo.git` */
const GITHUB_SSH = /^git@github\.com:(.+)$/;

/** `ssh://git@github.com/owner/repo.git` */
const GITHUB_SSH_URL = /^ssh:\/\/git@github\.com\/(.+)$/;

/** Strip the `.git` a clone URL ends with, and any trailing slash or `.git/`. */
function trimRepoPath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}

/** A path that names a place on this machine rather than a repository on GitHub. */
function isLocalPath(source: string): boolean {
  return (
    source.startsWith('/') ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('~')
  );
}

/** The path portion of an http(s) GitHub URL, or undefined when the URL is another host. */
function githubPath(url: URL): string | undefined {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.hostname !== GITHUB_HOST && url.hostname !== `www.${GITHUB_HOST}`) return undefined;
  return url.pathname;
}

/**
 * The `owner/repo` a GitHub source names, or null when the source is not a
 * GitHub one. A trailing `@ref` is dropped, because a manifest entry carries its
 * ref in its own key.
 */
export function githubOwnerRepo(source: string): string | null {
  let candidate = source.trim();
  if (candidate === '') return null;

  // A ref follows the repository: `https://github.com/o/r.git@v1`. The `@` in
  // `git@github.com:o/r` names a user, so only an `@` with no `/` after it can
  // start a ref.
  const at = candidate.lastIndexOf('@');
  if (at > 0 && !candidate.slice(at).includes('/')) candidate = candidate.slice(0, at);

  if (candidate.startsWith('github:')) {
    const repo = trimRepoPath(candidate.slice('github:'.length));
    return OWNER_REPO.test(repo) ? repo : null;
  }

  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return null;
    }
    const path = githubPath(url);
    if (path === undefined) return null;
    const repo = trimRepoPath(path);
    return OWNER_REPO.test(repo) ? repo : null;
  }

  const ssh = candidate.match(GITHUB_SSH) ?? candidate.match(GITHUB_SSH_URL);
  if (ssh?.[1] !== undefined) {
    const repo = trimRepoPath(ssh[1]);
    return OWNER_REPO.test(repo) ? repo : null;
  }

  // Already the form the manifest uses, and the only form a bare string can be
  // taken to mean: guessing a host for `something/else` would invent a source.
  if (isLocalPath(candidate) || candidate.includes('://') || candidate.includes(':')) return null;
  return OWNER_REPO.test(candidate) ? candidate : null;
}

/**
 * The form to show a human for a source: `owner/repo` for a GitHub source, and
 * the source unchanged for anything else (a local path, a GitLab URL), so the
 * output never claims a repository the source does not name.
 */
export function displaySource(source: string): string {
  return githubOwnerRepo(source) ?? source;
}
