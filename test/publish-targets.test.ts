import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPublishTargets } from '../src/core/publish-targets.js';
import * as adapter from '../src/skills/index.js';
import type { ListedSkill } from '../src/skills/index.js';

/** A stand-in for what the `skills` lock file reports for a globally installed skill. */
function installedFrom(name: string, source?: string): ListedSkill {
  return {
    name,
    description: `The ${name} skill`,
    scope: 'global',
    path: `/home/someone/.agents/skills/${name}`,
    agents: ['claude-code'],
    agentNames: ['Claude Code'],
    ...(source !== undefined && { source }),
  };
}

describe('collectPublishTargets', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kitcrate-publish-targets-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function writeLockfile(collections: Record<string, { source: string; scope: string }>) {
    const entries = Object.fromEntries(
      Object.entries(collections).map(([name, entry]) => [
        name,
        {
          source: entry.source,
          ref: 'v0.1.0',
          commit: '9f3a1c2dedbeef',
          manifestHash: 'sha256-ab12',
          skills: [],
          preexisting: [],
          scope: entry.scope,
        },
      ])
    );
    await writeFile(
      join(root, 'kitcrate-lock.json'),
      JSON.stringify({ version: 1, collections: entries }, null, 2) + '\n',
      'utf8'
    );
  }

  function stubGlobal(skills: readonly ListedSkill[]): void {
    vi.spyOn(adapter, 'listInstalledSkills').mockResolvedValue(skills);
  }

  it('names every lockfile entry, with the scope it was installed at', async () => {
    await writeLockfile({
      'web-security': { source: 'github:acme/web-security', scope: 'project' },
      shared: { source: 'github:acme/shared-skills', scope: 'global' },
    });
    stubGlobal([]);

    expect(await collectPublishTargets(root)).toEqual([
      {
        name: 'web-security',
        source: 'github:acme/web-security',
        scope: 'project',
        origin: 'lockfile',
      },
      {
        name: 'shared',
        source: 'github:acme/shared-skills',
        scope: 'global',
        origin: 'lockfile',
      },
    ]);
  });

  it('takes each distinct repository the global skills came from as a candidate', async () => {
    stubGlobal([
      installedFrom('alpha', 'acme/web-security'),
      installedFrom('beta', 'acme/web-security'),
      installedFrom('burp-notes', 'https://github.com/other/shared-skills.git'),
      // A skill with no recorded source names no repository to publish.
      installedFrom('local-only'),
    ]);

    const targets = await collectPublishTargets(root);

    expect(targets).toEqual([
      {
        name: 'acme/web-security',
        source: 'acme/web-security',
        scope: 'global',
        origin: 'global-skills',
      },
      {
        name: 'other/shared-skills',
        source: 'https://github.com/other/shared-skills.git',
        scope: 'global',
        origin: 'global-skills',
      },
    ]);
  });

  it('lists a collection once when the lockfile and the global skills both name it', async () => {
    await writeLockfile({
      'web-security': { source: 'github:acme/web-security', scope: 'global' },
    });
    // The same repository, recorded in the other form a clone URL can take.
    stubGlobal([
      installedFrom('alpha', 'https://github.com/acme/web-security.git'),
      installedFrom('beta', 'acme/web-security'),
    ]);

    expect(await collectPublishTargets(root)).toEqual([
      {
        name: 'web-security',
        source: 'github:acme/web-security',
        scope: 'global',
        origin: 'lockfile',
      },
    ]);
  });

  it('returns nothing when there is no collection at all', async () => {
    stubGlobal([]);

    expect(await collectPublishTargets(root)).toEqual([]);
  });

  it('labels a global candidate by its repository, since its name is not known yet', async () => {
    stubGlobal([installedFrom('alpha', '/home/someone/scratch/skills')]);

    expect(await collectPublishTargets(root)).toEqual([
      {
        name: '/home/someone/scratch/skills',
        source: '/home/someone/scratch/skills',
        scope: 'global',
        origin: 'global-skills',
      },
    ]);
  });
});
