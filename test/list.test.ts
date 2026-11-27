import { describe, expect, it, vi } from 'vitest';
import type { CollectionLockEntry } from '../src/core/lockfile.js';
import {
  abbreviateHome,
  buildListedEntries,
  formatAgents,
  formatEntry,
  formatList,
  toJsonList,
  type InstalledSkill,
} from '../src/core/listing.js';

function collection(overrides: Partial<CollectionLockEntry> = {}): CollectionLockEntry {
  return {
    source: 'github:matt711/mywebskills',
    ref: 'v1',
    commit: '9f3a1c2dedbeef',
    manifestHash: 'sha256-ab12',
    skills: ['account-activity'],
    preexisting: [],
    scope: 'project',
    ...overrides,
  };
}

function installed(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name: 'account-activity',
    scope: 'project',
    path: '/home/someone/abc/.agents/skills/account-activity',
    agents: ['claude-code', 'codex', 'fx', 'gemini-cli', 'github-copilot', 'cursor', 'windsurf'],
    agentNames: [
      'Claude Code',
      'Codex',
      'fx',
      'Gemini CLI',
      'GitHub Copilot',
      'Cursor',
      'Windsurf',
    ],
    source: 'acme/webtools',
    ...overrides,
  };
}

describe('list formatting', () => {
  it('renders a skill, its agents, its collection, and its own source', () => {
    vi.stubEnv('HOME', '/home/someone');
    const entries = buildListedEntries(
      [['web-security', collection()]],
      [installed({ path: '/home/someone/.agents/skills/account-activity' })]
    );

    expect(formatList(entries, false)).toBe(
      [
        'account-activity ~/.agents/skills/account-activity',
        '',
        'Agents: Claude Code, Codex, fx, Gemini CLI, GitHub Copilot +2 more',
        '',
        'Collection: github:matt711/mywebskills',
        '',
        'Source: acme/webtools',
      ].join('\n')
    );
    vi.unstubAllEnvs();
  });

  it('leaves out ref, commit, manifest hash, and only', () => {
    const entries = buildListedEntries(
      [['web-security', collection({ only: ['account-activity'] })]],
      [installed()]
    );

    const text = formatList(entries, false);

    for (const dropped of ['ref', 'commit', 'manifestHash', 'manifest-hash', 'only', '9f3a1c2']) {
      expect(text).not.toContain(dropped);
    }
  });

  it('truncates the agents line after five names', () => {
    expect(formatAgents(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A, B, C, D, E +2 more');
    expect(formatAgents(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C, D, E');
    expect(formatAgents(['A'])).toBe('A');
  });

  it('abbreviates the home directory and leaves other paths alone', () => {
    expect(abbreviateHome('/home/someone/abc/.agents/skills/x', '/home/someone')).toBe(
      '~/abc/.agents/skills/x'
    );
    expect(abbreviateHome('/home/someone', '/home/someone')).toBe('~');
    expect(abbreviateHome('/opt/skills/x', '/home/someone')).toBe('/opt/skills/x');
    expect(abbreviateHome('/home/someone-else/x', '/home/someone')).toBe('/home/someone-else/x');
  });

  it('keeps a locked skill that is not installed, and says so', () => {
    const entries = buildListedEntries(
      [['web-security', collection({ skills: ['account-activity', 'gone'] })]],
      [installed()]
    );

    const text = formatList(entries, false);

    expect(text).toContain('gone (not installed)');
    expect(text).toContain('Source: not recorded in skills-lock.json');
  });

  it('marks a skill that predates the collection and separates entries with a blank line', () => {
    const entries = buildListedEntries(
      [
        [
          'web-security',
          collection({ preexisting: ['account-activity'], skills: ['account-activity'] }),
        ],
        ['other', collection({ source: 'github:acme/other', skills: ['beta'] })],
      ],
      [installed(), installed({ name: 'beta', source: 'acme/beta' })]
    );

    const text = formatList(entries, false);

    expect(text).toContain('account-activity (preexisting) ');
    expect(text.split('\n\n\n')).toHaveLength(1);
    expect(text).toContain('Collection: github:acme/other');
  });

  it('matches a member by name and scope, not by name alone', () => {
    const collections = [['mywebskills', collection({ skills: ['account-activity'] })]] as const;
    const globalCopy = installed({
      scope: 'global',
      path: '/home/someone/.agents/skills/account-activity',
      agents: ['claude-code', 'openclaw'],
      agentNames: ['Claude Code', 'OpenClaw'],
      source: 'aave/skills',
    });
    const projectCopy = installed({ source: 'acme/webtools' });

    // The global copy is listed first, the way the adapter orders by scope.
    const entries = buildListedEntries(collections, [globalCopy, projectCopy]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('/home/someone/abc/.agents/skills/account-activity');
    expect(entries[0]?.agents).toEqual(projectCopy.agentNames);
    expect(entries[0]?.source).toBe('acme/webtools');
    expect(entries[0]?.scope).toBe('project');
  });

  it('reports a global collection from its global copy', () => {
    const collections = [['mywebskills', collection({ scope: 'global' })]] as const;

    const entries = buildListedEntries(collections, [
      installed({ source: 'acme/webtools' }),
      installed({ scope: 'global', source: 'aave/skills' }),
    ]);

    expect(entries[0]?.source).toBe('aave/skills');
  });

  it('reports an empty listing plainly', () => {
    expect(formatList([])).toBe('No collections installed.');
    expect(formatEntry(buildListedEntries([['c', collection()]], [installed()])[0]!)).toContain(
      'Agents: Claude Code'
    );
  });

  it('carries agent ids next to display names in the JSON view, one row per skill', () => {
    const collections = [['web-security', collection()]] as const;
    const entries = buildListedEntries(collections, [installed()]);

    const view = toJsonList(collections, entries);

    expect(view.skills).toHaveLength(1);
    expect(view.skills[0]?.agents[0]).toEqual({ id: 'claude-code', name: 'Claude Code' });
    expect(view.collections[0]).toMatchObject({ commit: '9f3a1c2dedbeef', ref: 'v1' });
  });
});
