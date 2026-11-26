import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureEnvIgnoreRules } from '../src/core/gitignore.js';

describe('ensureEnvIgnoreRules', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function setupDir(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'kitcrate-gitignore-test-'));
    return dir;
  }

  it('creates a .gitignore when none exists', async () => {
    await setupDir();
    const status = await ensureEnvIgnoreRules(dir);
    expect(status).toBe('created');
    const content = await readFile(join(dir, '.gitignore'), 'utf8');
    expect(content).toContain('.env');
    expect(content).toContain('.env.*');
    expect(content).toContain('!.env.example');
  });

  it('appends the managed block to an existing .gitignore, keeping user rules', async () => {
    await setupDir();
    await writeFile(join(dir, '.gitignore'), 'node_modules\ndist\n', 'utf8');
    const status = await ensureEnvIgnoreRules(dir);
    expect(status).toBe('appended');
    const content = await readFile(join(dir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules');
    expect(content).toContain('dist');
    expect(content).toContain('.env');
    expect(content).toContain('!.env.example');
  });

  it('puts the negation last so it wins over earlier rules', async () => {
    await setupDir();
    await writeFile(join(dir, '.gitignore'), '.env.*\n', 'utf8');
    await ensureEnvIgnoreRules(dir);
    const content = await readFile(join(dir, '.gitignore'), 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const ignoreIndex = lines.indexOf('.env.*');
    const negateIndex = lines.indexOf('!.env.example');
    expect(negateIndex).toBeGreaterThan(ignoreIndex);
  });

  it('is idempotent', async () => {
    await setupDir();
    await ensureEnvIgnoreRules(dir);
    const first = await readFile(join(dir, '.gitignore'), 'utf8');
    const status = await ensureEnvIgnoreRules(dir);
    expect(status).toBe('unchanged');
    const second = await readFile(join(dir, '.gitignore'), 'utf8');
    expect(second).toBe(first);
  });

  it('replaces a stale managed block instead of duplicating rules', async () => {
    await setupDir();
    await writeFile(
      join(dir, '.gitignore'),
      '# kitcrate: environment files may contain secrets\n.env\n',
      'utf8'
    );
    const status = await ensureEnvIgnoreRules(dir);
    expect(status).toBe('appended');
    const content = await readFile(join(dir, '.gitignore'), 'utf8');
    expect(content.match(/# kitcrate:/g)).toHaveLength(1);
    expect(content).toContain('!.env.example');
  });
});
