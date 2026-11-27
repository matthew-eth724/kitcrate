import { describe, expect, it, vi, afterEach } from 'vitest';
import * as adapter from '../src/skills/index.js';
import type { ListedSkill } from '../src/skills/index.js';
import { resolveMemberSources } from '../src/core/member-sources.js';

/** A stand-in for what the `skills` lock file reports for an installed copy. */
function copy(
  name: string,
  source: string | undefined,
  scope: 'project' | 'global' = 'global'
): ListedSkill {
  return {
    name,
    description: `The ${name} skill`,
    scope,
    path: `/home/someone/.agents/skills/${name}`,
    agents: ['claude-code'],
    agentNames: ['Claude Code'],
    ...(source !== undefined && { source }),
  };
}

/** Make the adapter report the given installed copies. */
function stubInstalled(skills: readonly ListedSkill[]): void {
  vi.spyOn(adapter, 'listInstalledSkills').mockResolvedValue(skills);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveMemberSources', () => {
  it('names the repository a skill came from', async () => {
    stubInstalled([copy('account-activity', 'acme/webtools')]);

    const sources = await resolveMemberSources([{ name: 'account-activity' }]);

    expect(sources.byName.get('account-activity')).toBe('acme/webtools');
    expect(sources.unattributed).toHaveLength(0);
  });

  it('parses a source URL into owner/repo', async () => {
    stubInstalled([copy('account-activity', 'https://github.com/acme/webtools.git')]);

    const sources = await resolveMemberSources([{ name: 'account-activity' }]);

    expect(sources.byName.get('account-activity')).toBe('acme/webtools');
  });

  it('uses the attributed copy when another copy records no source', async () => {
    // The project copy is the folder being published, so it has no lock entry
    // of its own. That must not hide the global copy's source.
    stubInstalled([
      copy('account-activity', undefined, 'project'),
      copy('account-activity', 'acme/webtools', 'global'),
    ]);

    const sources = await resolveMemberSources([{ name: 'account-activity' }]);

    expect(sources.byName.get('account-activity')).toBe('acme/webtools');
    expect(sources.unattributed).toHaveLength(0);
  });

  it('gives up when two copies name different repositories', async () => {
    stubInstalled([
      copy('account-activity', 'acme/webtools', 'project'),
      copy('account-activity', 'other/repo', 'global'),
    ]);

    const sources = await resolveMemberSources([{ name: 'account-activity' }]);

    expect(sources.byName.has('account-activity')).toBe(false);
    expect(sources.unattributed[0]?.reason).toContain('acme/webtools');
    expect(sources.unattributed[0]?.reason).toContain('other/repo');
  });

  it('gives up on a source that is not a GitHub repository', async () => {
    stubInstalled([copy('account-activity', '/home/someone/scratch/skills')]);

    const sources = await resolveMemberSources([{ name: 'account-activity' }]);

    expect(sources.byName.has('account-activity')).toBe(false);
    expect(sources.unattributed[0]?.reason).toContain('not a GitHub repository');
  });

  it('gives up on a skill that is not installed at all', async () => {
    stubInstalled([]);

    const sources = await resolveMemberSources([{ name: 'account-activity' }]);

    expect(sources.byName.has('account-activity')).toBe(false);
    expect(sources.unattributed[0]?.reason).toContain('records no source');
  });
});
