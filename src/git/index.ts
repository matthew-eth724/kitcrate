import { execFile } from 'child_process';

/** Result of a git command. */
export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Run a command and return its result instead of throwing on failure. */
function run(command: string, args: readonly string[], cwd?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args as string[],
      { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code });
      }
    );
  });
}

/** Run a git command and return its result. */
export function git(args: readonly string[], cwd?: string): Promise<GitResult> {
  return run('git', args, cwd);
}

/** Run a GitHub CLI command and return its result. */
export function gh(args: readonly string[], cwd?: string): Promise<GitResult> {
  return run('gh', args, cwd);
}

/** Resolve a ref (branch/tag/commit) to a full commit SHA in a remote repo. */
export async function resolveRef(url: string, ref: string): Promise<string> {
  const result = await git(['ls-remote', url, ref]);
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new Error(
      `Failed to resolve ref "${ref}" from ${url}: ${result.stderr.trim() || result.stdout.trim()}`
    );
  }
  // ls-remote output: "<commit>\t"
  const line = result.stdout.trim().split('\n')[0];
  const commit = line.split('\t')[0];
  if (!commit || commit.length < 6) {
    throw new Error(`Could not parse commit SHA from ls-remote output for ${ref} in ${url}`);
  }
  return commit;
}

/** Read a file's contents at a specific commit from a local git repo. */
export async function showFileAtCommit(
  cwd: string,
  commit: string,
  filePath: string
): Promise<string> {
  const result = await git(['show', `${commit}:${filePath}`], cwd);
  if (result.code !== 0) {
    throw new Error(`Failed to read ${filePath} at ${commit}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Clone a repo (shallow at a ref if provided) into a directory. */
export async function cloneRepo(url: string, dir: string, ref?: string): Promise<void> {
  const args: string[] = ['clone'];
  if (ref) {
    args.push('--branch', ref, '--depth', '1');
  }
  args.push(url, dir);
  const result = await git(args);
  if (result.code !== 0) {
    throw new Error(`Failed to clone ${url} into ${dir}: ${result.stderr.trim()}`);
  }
}

/** True when the directory is inside a git repository. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await git(['rev-parse', '--git-dir'], cwd);
  return result.code === 0;
}

/** True when the repository has at least one commit. */
export async function hasCommits(cwd: string): Promise<boolean> {
  const result = await git(['rev-parse', '--verify', 'HEAD'], cwd);
  return result.code === 0;
}

/** Files tracked in the git index: what the next commit would contain. */
export async function listTrackedFiles(cwd: string): Promise<string[]> {
  const result = await git(['ls-files', '-z'], cwd);
  if (result.code !== 0) return [];
  return result.stdout.split('\0').filter(Boolean);
}

/** Files committed in HEAD. Used to catch credentials hiding in history. */
export async function listCommittedFiles(cwd: string): Promise<string[]> {
  const result = await git(['ls-tree', '-r', '--name-only', '-z', 'HEAD'], cwd);
  if (result.code !== 0) return [];
  return result.stdout.split('\0').filter(Boolean);
}

/** Stage specific paths. Never use `git add .` here. */
export async function stagePaths(cwd: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const result = await git(['add', '--', ...paths], cwd);
  if (result.code !== 0) {
    throw new Error(`Failed to stage files: ${result.stderr.trim()}`);
  }
}

/**
 * Files that are staged but not yet committed: the content the next commit
 * would sweep in. In a repository with no commits this is every tracked file.
 */
export async function listStagedChanges(cwd: string): Promise<string[]> {
  const result = await git(['diff', '--cached', '--name-only', '-z'], cwd);
  if (result.code !== 0) return [];
  return result.stdout.split('\0').filter(Boolean);
}

/** Remove a path from the index, keeping the file in the working tree. */
export async function unstagePath(cwd: string, path: string): Promise<void> {
  const result = await git(['rm', '--cached', '--quiet', '--', path], cwd);
  if (result.code !== 0) {
    throw new Error(`Failed to unstage ${path}: ${result.stderr.trim()}`);
  }
}
