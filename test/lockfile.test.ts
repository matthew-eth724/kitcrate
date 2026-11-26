import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readLockfile,
  writeLockfile,
  computeLockfileHash,
  LOCKFILE_VERSION,
  type Lockfile,
} from '../src/core/lockfile.js';

const baseLockfile: Lockfile = {
  version: LOCKFILE_VERSION,
  collections: {
    'web-security': {
      source: 'github:acme/web-security',
      ref: 'v1',
      commit: '9f3a1c2',
      manifestHash: 'sha256-ab12',
      skills: ['sqli-checks', 'xss-review'],
      preexisting: ['xss-review'],
    },
  },
};

describe('lockfile', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function setupDir(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'kitcrate-test-'));
    return dir;
  }

  it('returns empty lockfile when none exists', async () => {
    await setupDir();
    const lockfile = await readLockfile(dir);
    expect(lockfile.version).toBe(LOCKFILE_VERSION);
    expect(lockfile.collections).toEqual({});
  });

  it('writes and reads back a lockfile with sorted keys', async () => {
    await setupDir();
    await writeLockfile(dir, baseLockfile);
    const readBack = await readLockfile(dir);
    expect(readBack.collections['web-security'].source).toBe('github:acme/web-security');
    expect(readBack.collections['web-security'].skills).toEqual(['sqli-checks', 'xss-review']);
  });

  it('sorts keys alphabetically in output', async () => {
    await setupDir();
    const unsorted: Lockfile = {
      version: 1,
      collections: {
        'zzz-collection': {
          source: 'a',
          ref: 'b',
          commit: 'c',
          manifestHash: 'd',
          skills: [],
          preexisting: [],
        },
        'aaa-collection': {
          source: 'a',
          ref: 'b',
          commit: 'c',
          manifestHash: 'd',
          skills: [],
          preexisting: [],
        },
      },
    };
    await writeLockfile(dir, unsorted);
    const content = await require('fs/promises').readFile(join(dir, 'kitcrate-lock.json'), 'utf8');
    const parsed = JSON.parse(content);
    const keys = Object.keys(parsed.collections);
    expect(keys).toEqual(['aaa-collection', 'zzz-collection']);
  });

  it('produces trailing newline', async () => {
    await setupDir();
    await writeLockfile(dir, baseLockfile);
    const content = await require('fs/promises').readFile(join(dir, 'kitcrate-lock.json'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('throws LockfileVersionError for unknown version', async () => {
    await setupDir();
    await writeFile(
      join(dir, 'kitcrate-lock.json'),
      JSON.stringify({ version: 99, collections: {} }),
      'utf8'
    );
    await expect(readLockfile(dir)).rejects.toThrow(/Unknown kitcrate-lock.json version/);
  });

  it('throws on malformed JSON', async () => {
    await setupDir();
    await writeFile(join(dir, 'kitcrate-lock.json'), '{ not valid json', 'utf8');
    await expect(readLockfile(dir)).rejects.toThrow(/Invalid JSON/);
  });

  it('computeLockfileHash is deterministic', async () => {
    const h1 = computeLockfileHash(baseLockfile);
    const h2 = computeLockfileHash(baseLockfile);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeLockfileHash differs when collections change', async () => {
    const h1 = computeLockfileHash(baseLockfile);
    const modified: Lockfile = {
      ...baseLockfile,
      collections: {
        ...baseLockfile.collections,
        'web-security': {
          ...baseLockfile.collections['web-security']!,
          commit: 'different-commit',
        },
      },
    };
    const h2 = computeLockfileHash(modified);
    expect(h1).not.toBe(h2);
  });
});
