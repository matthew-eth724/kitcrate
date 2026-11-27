import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'fs/promises';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { discoverSkillsInDirectory } from '../src/skills/index.js';
import { createCommand } from '../src/commands/create.js';
import { normalizeCollectionName } from '../src/core/name.js';
import { git } from '../src/git/index.js';

/** Write a minimal SKILL.md with the given frontmatter into `dir`. */
async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    'utf8'
  );
}

/**
 * A stand-in for `gh repo create <name> --source <dir> --push [--remote <name>]`.
 * It fails the way gh does when the requested remote name is already taken,
 * and records the name it was asked for so the test can read it back.
 */
const GH_STUB = `#!/bin/sh
source_dir=""
remote="origin"
while [ $# -gt 0 ]; do
  case "$1" in
    --source) source_dir="$2"; shift 2 ;;
    --remote|-r) remote="$2"; shift 2 ;;
    --push|--public|--private) shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$remote" > "$GH_STUB_LOG"
if git -C "$source_dir" remote get-url "$remote" >/dev/null 2>&1; then
  echo "X Unable to add remote \\"$remote\\"" >&2
  exit 1
fi
git -C "$source_dir" remote add "$remote" "https://github.com/fixture/$remote.git" 2>/dev/null
exit 0
`;

describe('discoverSkillsInDirectory', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kitcrate-discover-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds skills under .agents/skills/<name>/SKILL.md', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'xss-review'), 'xss-review', 'Review for XSS');

    const skills = await discoverSkillsInDirectory(root);

    expect(skills).toEqual([
      { name: 'xss-review', description: 'Review for XSS', path: '.agents/skills/xss-review' },
    ]);
  });

  it('finds skills under skills/<name>/SKILL.md', async () => {
    await writeSkill(join(root, 'skills', 'sqli-checks'), 'sqli-checks', 'Check SQL injection');

    const skills = await discoverSkillsInDirectory(root);

    expect(skills).toEqual([
      { name: 'sqli-checks', description: 'Check SQL injection', path: 'skills/sqli-checks' },
    ]);
  });

  it('finds skills in both layouts and returns their paths', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'xss-review'), 'xss-review', 'Review XSS');
    await writeSkill(join(root, 'skills', 'sqli-checks'), 'sqli-checks', 'Check SQLi');

    const skills = await discoverSkillsInDirectory(root);

    expect(skills.map((s) => s.name).sort()).toEqual(['sqli-checks', 'xss-review']);
    expect(skills.map((s) => s.path).sort()).toEqual([
      '.agents/skills/xss-review',
      'skills/sqli-checks',
    ]);
  });

  it('returns an empty array when the directory holds no skills', async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'index.ts'), 'export {};\n', 'utf8');

    expect(await discoverSkillsInDirectory(root)).toEqual([]);
  });
});

describe('createCommand', () => {
  let root: string;
  let binDir: string;
  let originalPath: string | undefined;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kitcrate-create-'));
    binDir = await mkdtemp(join(tmpdir(), 'kitcrate-bin-'));

    // A `gh` stub keeps the test off the network.
    await writeGhStub(GH_STUB);

    originalPath = process.env['PATH'];
    process.env['PATH'] = `${binDir}:${originalPath ?? ''}`;
    process.env['GH_STUB_LOG'] = join(root, 'gh.log');

    originalEnv = {
      author: process.env['GIT_AUTHOR_NAME'],
      email: process.env['GIT_AUTHOR_EMAIL'],
      committer: process.env['GIT_COMMITTER_NAME'],
      committerEmail: process.env['GIT_COMMITTER_EMAIL'],
      stubLog: process.env['GH_STUB_LOG'],
    };
    process.env['GIT_AUTHOR_NAME'] = 'kitcrate test';
    process.env['GIT_AUTHOR_EMAIL'] = 'test@kitcrate.local';
    process.env['GIT_COMMITTER_NAME'] = 'kitcrate test';
    process.env['GIT_COMMITTER_EMAIL'] = 'test@kitcrate.local';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = originalPath;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  /** Replace the `gh` stand-in on PATH. */
  async function writeGhStub(script: string): Promise<void> {
    const ghStub = join(binDir, 'gh');
    await writeFile(ghStub, script, 'utf8');
    await chmod(ghStub, 0o755);
  }

  /** The remote name the `gh` stand-in was asked to use. */
  async function requestedRemote(): Promise<string> {
    return (await readFile(join(root, 'gh.log'), 'utf8')).trim();
  }

  /** Run create non-interactively and capture what it printed. */
  async function runCreate(dir: string): Promise<{ code: number; stdout: string }> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await createCommand([dir], { yes: true, json: true, debug: false, global: false });
    return { code, stdout: lines.join('\n') };
  }

  it('publishes every discovered skill and reports the result as JSON', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await writeSkill(join(root, '.agents', 'skills', 'beta'), 'beta', 'The beta skill');

    const { code, stdout } = await runCreate(root);

    expect(code).toBe(0);
    const result = JSON.parse(stdout) as {
      name: string;
      skills: string[];
      published: boolean;
    };
    // The directory name is normalized into the convention, uppercase included.
    const expected = normalizeCollectionName(basename(root));
    expect(expected.ok).toBe(true);
    expect(result.name).toBe(expected.ok ? expected.name : '');
    expect(result.skills.sort()).toEqual(['alpha', 'beta']);
    expect(result.published).toBe(true);
  });

  it('commits the collection files and the skill folders', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');

    await runCreate(root);

    const tracked = await git(['ls-files', '-z'], root);
    expect(tracked.stdout.split('\0').filter(Boolean).sort()).toEqual([
      '.agents/skills/alpha/SKILL.md',
      '.gitignore',
      'collection.json',
    ]);
  });

  it('keeps credential files out of the commit but leaves them on disk', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await writeFile(join(root, '.env'), 'TOKEN=secret\n', 'utf8');

    const { code } = await runCreate(root);

    expect(code).toBe(0);
    const tracked = await git(['ls-files', '-z'], root);
    expect(tracked.stdout).not.toContain('.env');
  });

  it('publishes even when a file that would be pushed contains a secret pattern', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await writeFile(
      join(root, '.agents', 'skills', 'alpha', 'config.txt'),
      `token = ghp_${'a'.repeat(40)}\n`,
      'utf8'
    );

    const { code } = await runCreate(root);

    expect(code).toBe(0);
    const tracked = await git(['ls-files', '-z'], root);
    expect(tracked.stdout).toContain('config.txt');
  });

  it('warns but still publishes when the history already holds a credential file', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await git(['init'], root);
    await writeFile(join(root, '.env'), 'TOKEN=secret\n', 'utf8');
    await git(['add', '--', '.env'], root);
    await git(['commit', '-m', 'a commit that should not have existed'], root);

    const { code } = await runCreate(root);

    expect(code).toBe(0);
    const log = await git(['log', '--oneline'], root);
    expect(log.stdout).toContain('a commit that should not have existed');
  });

  it('refuses to publish when the repository already has staged changes', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await git(['init'], root);
    await writeFile(join(root, 'notes.md'), 'not part of the collection\n', 'utf8');
    await git(['add', '--', 'notes.md'], root);

    const { code } = await runCreate(root);

    expect(code).toBe(1);
    const log = await git(['log', '--oneline'], root);
    expect(log.code).not.toBe(0);
    // The author's own staged work is left exactly as it was.
    const staged = await git(['diff', '--cached', '--name-only', '-z'], root);
    expect(staged.stdout.split('\0').filter(Boolean)).toEqual(['notes.md']);
  });

  it('reports skills that were skipped for invalid frontmatter', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    const broken = join(root, '.agents', 'skills', 'broken');
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, 'SKILL.md'), '# no frontmatter\n', 'utf8');

    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });

    const code = await createCommand([root], {
      yes: true,
      json: true,
      debug: false,
      global: false,
    });

    expect(code).toBe(0);
    expect(errors.join('\n')).toMatch(/Skipped 1 invalid skill/);
    expect(errors.join('\n')).toMatch(/frontmatter/);
  });

  it('publishes into a repository that already has an origin remote', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await git(['init'], root);
    await git(['remote', 'add', 'origin', 'https://github.com/fixture/existing.git'], root);

    const { code, stdout } = await runCreate(root);

    expect(code).toBe(0);
    // gh was asked for a remote name it could actually add.
    expect(await requestedRemote()).not.toBe('origin');
    // The author's own remote is left exactly as it was.
    const remotes = await git(['remote'], root);
    expect(remotes.stdout.split('\n').filter(Boolean).sort()).toEqual(['github', 'origin']);
    const originUrl = await git(['remote', 'get-url', 'origin'], root);
    expect(originUrl.stdout.trim()).toBe('https://github.com/fixture/existing.git');
    // The machine-readable output says where it was published.
    expect((JSON.parse(stdout) as { remote: string }).remote).toBe('github');
  });

  it('publishes on a retry after the first publish failed', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await writeGhStub('#!/bin/sh\necho "X Could not reach GitHub" >&2\nexit 1\n');

    const first = await runCreate(root);
    expect(first.code).toBe(1);
    // The failed run left a commit behind, which the retry has to cope with.
    const log = await git(['log', '--oneline'], root);
    expect(log.stdout).toContain('initial collection');

    await writeGhStub(GH_STUB);
    const second = await runCreate(root);

    expect(second.code).toBe(0);
    expect(await requestedRemote()).toBe('origin');
  });

  it('retries a failed publish when the repository also holds untracked files', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await writeGhStub('#!/bin/sh\necho "X Could not reach GitHub" >&2\nexit 1\n');

    expect((await runCreate(root)).code).toBe(1);
    // An untracked file changes the wording git uses to refuse an empty
    // commit, so the retry must not depend on reading that wording.
    await writeFile(join(root, 'README.md'), 'notes\n', 'utf8');

    await writeGhStub(GH_STUB);
    const second = await runCreate(root);

    expect(second.code).toBe(0);
    // The author's own file was never swept into the collection.
    const tracked = await git(['ls-files', '-z'], root);
    expect(tracked.stdout).not.toContain('README.md');
  });

  it('moves a release tag left by an earlier create run to the commit this run made', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await git(['init'], root);
    await git(['add', '--', '.agents'], root);
    await git(['commit', '-m', 'chore: initial collection alpha v0.1.0'], root);
    await git(['tag', 'v0.1.0'], root);
    const tagged = (await git(['rev-parse', 'HEAD'], root)).stdout.trim();

    // The collection changes, so this run makes a new commit.
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill, revised');
    await writeSkill(join(root, '.agents', 'skills', 'beta'), 'beta', 'The beta skill');

    const { code } = await runCreate(root);

    expect(code).toBe(0);
    const head = (await git(['rev-parse', 'HEAD'], root)).stdout.trim();
    expect(head).not.toBe(tagged);
    // The release tag now marks the collection that was published.
    const release = (await git(['rev-list', '-n', '1', 'v0.1.0'], root)).stdout.trim();
    expect(release).toBe(head);
  });

  it('refuses to move a release tag kitcrate did not make', async () => {
    await writeSkill(join(root, '.agents', 'skills', 'alpha'), 'alpha', 'The alpha skill');
    await git(['init'], root);
    await git(['add', '--', '.agents'], root);
    await git(['commit', '-m', 'a commit of the author own'], root);
    await git(['tag', 'v0.1.0'], root);
    const tagged = (await git(['rev-parse', 'HEAD'], root)).stdout.trim();

    const { code } = await runCreate(root);

    expect(code).toBe(1);
    // The author's own tag is left exactly where it was.
    const release = (await git(['rev-list', '-n', '1', 'v0.1.0'], root)).stdout.trim();
    expect(release).toBe(tagged);
    // And nothing was published.
    const remotes = await git(['remote'], root);
    expect(remotes.stdout.trim()).toBe('');
  });
});
