import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCommand } from '../src/commands/add.js';
import { installCommand } from '../src/commands/install.js';
import { removeCommand } from '../src/commands/remove.js';
import { listCommand } from '../src/commands/list.js';
import { computeManifestHash } from '../src/core/hash.js';
import type { CommandOptions } from '../src/core/options.js';

/** Minimal collection.json with one skill, shared by the fixtures below. */
const MANIFEST = {
  name: 'probe-collection',
  version: '0.1.0',
  description: 'A collection the add tests install',
  skills: [{ source: '.', skill: 'alpha' }],
};

/** Write a skill at `<dir>/skills/<name>/SKILL.md`, the `skills` package's non-canonical layout. */
async function writeSkill(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n# ${name}\n`,
    'utf8'
  );
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

describe('install scope', () => {
  let root: string;
  let project: string;
  let collection: string;
  let home: string;
  let originalHome: string | undefined;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kitcrate-add-'));
    project = join(root, 'project');
    collection = join(root, 'collection');
    home = join(root, 'home');
    await mkdir(project, { recursive: true });
    await mkdir(home, { recursive: true });

    // A local git repository stands in for the collection's remote.
    await writeSkill(join(collection, 'skills', 'alpha'), 'alpha');
    await writeFile(join(collection, 'collection.json'), JSON.stringify(MANIFEST), 'utf8');
    git(collection, 'init', '-q');
    git(collection, 'add', '-A');
    git(collection, 'commit', '-q', '-m', 'collection');

    // Keep the install out of the real home directory and off the network.
    originalHome = process.env['HOME'];
    process.env['HOME'] = home;
    originalEnv = {
      telemetry: process.env['DISABLE_TELEMETRY'],
      doNotTrack: process.env['DO_NOT_TRACK'],
    };
    process.env['DISABLE_TELEMETRY'] = '1';
    process.env['DO_NOT_TRACK'] = '1';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  function options(overrides: Partial<CommandOptions> = {}): CommandOptions {
    return { yes: true, json: false, debug: false, global: false, ...overrides };
  }

  async function run<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
    const previous = process.cwd();
    process.chdir(cwd);
    try {
      return await fn();
    } finally {
      process.chdir(previous);
    }
  }

  /** Run a command and return what it logged, for commands whose output is the result. */
  async function capture<T>(
    cwd: string,
    fn: () => Promise<T>
  ): Promise<{ result: T; log: string }> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const result = await run(cwd, fn);
    return { result, log: lines.join('\n') };
  }

  async function lockfileScope(): Promise<string> {
    const content = await readFile(join(project, 'kitcrate-lock.json'), 'utf8');
    return JSON.parse(content).collections['probe-collection'].scope;
  }

  async function skillLives(dir: string): Promise<boolean> {
    return readFile(join(dir, 'alpha', 'SKILL.md'), 'utf8').then(
      () => true,
      () => false
    );
  }

  it('adds a collection from a local git repository and pins its commit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const head = git(collection, 'rev-parse', 'HEAD');

    const code = await run(project, () => addCommand([collection], options()));

    expect(code).toBe(0);
    const entry = JSON.parse(await readFile(join(project, 'kitcrate-lock.json'), 'utf8'))
      .collections['probe-collection'];
    expect(entry.commit).toBe(head);
    expect(entry.source).toBe(collection);
    expect(await skillLives(join(project, '.agents', 'skills'))).toBe(true);
    // Reading the entry back proves the pinned commit passes the schema.
    const listed = await run(project, () => listCommand([], options({ json: true })));
    expect(listed).toBe(0);
  });

  it('adds a collection from a file:// URL of a local directory', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await run(project, () => addCommand([pathToFileURL(collection).href], options()));

    expect(code).toBe(0);
    expect(await lockfileScope()).toBe('project');
    expect(await skillLives(join(project, '.agents', 'skills'))).toBe(true);
  });

  it('installs into the global scope when the same collection is already installed project-wide', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(project, () => addCommand([collection], options()));
    // `add` refuses a collection already in the lockfile, so drop the entry the
    // way `remove` would and keep the project-scope skill on disk. That leaves
    // the skill installed in both `skills` lockfiles but owned by no collection.
    const path = join(project, 'kitcrate-lock.json');
    const lockfile = JSON.parse(await readFile(path, 'utf8'));
    lockfile.collections = {};
    await writeFile(path, JSON.stringify(lockfile, null, 2) + '\n', 'utf8');

    const code = await run(project, () => addCommand([collection], options({ global: true })));

    expect(code).toBe(0);
    expect(await lockfileScope()).toBe('global');
    expect(await skillLives(join(home, '.agents', 'skills'))).toBe(true);
    expect(await skillLives(join(project, '.agents', 'skills'))).toBe(true);
  });

  /** Write a lockfile naming this fixture's collection at the given scope. */
  async function writeLockfileFor(dir: string, scope: 'project' | 'global'): Promise<void> {
    const manifestHash = computeManifestHash(
      await readFile(join(collection, 'collection.json'), 'utf8')
    );
    await writeFile(
      join(dir, 'kitcrate-lock.json'),
      JSON.stringify({
        version: 1,
        collections: {
          'probe-collection': {
            source: collection,
            ref: 'HEAD',
            commit: git(collection, 'rev-parse', 'HEAD'),
            manifestHash,
            only: ['alpha'],
            skills: ['alpha'],
            preexisting: [],
            scope,
          },
        },
      }),
      'utf8'
    );
  }

  it('installs into the project and records project scope under --yes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run(project, () => addCommand([collection], options()));

    expect(code).toBe(0);
    expect(await lockfileScope()).toBe('project');
    expect(await skillLives(join(project, '.agents', 'skills'))).toBe(true);
    expect(await skillLives(join(home, '.agents', 'skills'))).toBe(false);
  });

  it('installs into the home directory and records global scope under --global', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run(project, () => addCommand([collection], options({ global: true })));

    expect(code).toBe(0);
    expect(await lockfileScope()).toBe('global');
    expect(await skillLives(join(home, '.agents', 'skills'))).toBe(true);
    expect(await skillLives(join(project, '.agents', 'skills'))).toBe(false);
  });

  it('removes the skill from the scope the lockfile recorded, not the project', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(project, () => addCommand([collection], options({ global: true })));

    const code = await run(project, () => removeCommand(['probe-collection'], options()));

    expect(code).toBe(0);
    expect(await skillLives(join(home, '.agents', 'skills'))).toBe(false);
  });

  it('reports each collection scope in list, as collection metadata and in JSON', async () => {
    await writeLockfileFor(project, 'global');

    const human = await capture(project, () => listCommand([], options()));
    expect(human.result).toBe(0);
    // The human output names the skill and the collection, not the scope line.
    expect(human.log).toContain('alpha');
    expect(human.log).toContain(`Collection: ${collection}`);
    expect(human.log).not.toContain('scope:');

    const machine = await capture(project, () => listCommand([], options({ json: true })));
    const listed = JSON.parse(machine.log) as { collections: Array<{ scope: string }> };
    expect(listed.collections[0]?.scope).toBe('global');
  });

  it('lists each skill once, with the agents it is installed for, as JSON', async () => {
    await writeLockfileFor(project, 'global');
    await run(project, () => installCommand([], options()));

    const machine = await capture(project, () => listCommand([], options({ json: true })));
    const listed = JSON.parse(machine.log) as {
      skills: Array<{
        name: string;
        path: string;
        agents: Array<{ id: string; name: string }>;
        collection: string;
      }>;
    };

    expect(listed.skills).toHaveLength(1);
    expect(listed.skills[0]?.name).toBe('alpha');
    expect(listed.skills[0]?.collection).toBe('probe-collection');
    expect(listed.skills[0]?.path.endsWith(join('alpha'))).toBe(true);
    expect(listed.skills[0]?.agents.length).toBeGreaterThan(0);
    // Valid JSON, so no terminal escape sequence reached the output.
    expect(machine.log).not.toMatch(/\u001b|\x1b/);
  });

  it('restores into the locked scope even when the skill already exists in the other one', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The skill is present project-wide, but the collection is locked global.
    await run(project, () => addCommand([collection], options()));
    await writeLockfileFor(project, 'global');

    const code = await run(project, () => installCommand([], options()));

    expect(code).toBe(0);
    expect(await skillLives(join(home, '.agents', 'skills'))).toBe(true);
  });

  it('restores a global collection into the home directory on install', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await writeLockfileFor(project, 'global');

    const code = await run(project, () => installCommand([], options()));

    expect(code).toBe(0);
    expect(await skillLives(join(home, '.agents', 'skills'))).toBe(true);
    expect(await skillLives(join(project, '.agents', 'skills'))).toBe(false);
  });
});
