import { mkdtemp, mkdir, writeFile, rm, chmod } from 'fs/promises';
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
    const ghStub = join(binDir, 'gh');
    await writeFile(ghStub, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(ghStub, 0o755);

    originalPath = process.env['PATH'];
    process.env['PATH'] = `${binDir}:${originalPath ?? ''}`;

    originalEnv = {
      author: process.env['GIT_AUTHOR_NAME'],
      email: process.env['GIT_AUTHOR_EMAIL'],
      committer: process.env['GIT_COMMITTER_NAME'],
      committerEmail: process.env['GIT_COMMITTER_EMAIL'],
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
});
