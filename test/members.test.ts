import { describe, expect, it } from 'vitest';
import type { CollectionManifest } from '../src/core/manifest.js';
import { planMemberInstalls } from '../src/core/members.js';

/** A manifest over the given `[source, skill]` pairs, in that order. */
function manifestOf(...entries: ReadonlyArray<readonly [string, string]>): CollectionManifest {
  return {
    name: 'web-security',
    version: '1.2.0',
    description: 'Web app security review skills',
    skills: entries.map(([source, skill]) => ({ source, skill })),
  };
}

const collection = { source: 'github:matt711/mywebskills', ref: 'v1' };

describe('planMemberInstalls', () => {
  it('installs "." from the collection’s own source at the collection’s ref', () => {
    const groups = planMemberInstalls(manifestOf(['.', 'alpha'], ['.', 'beta']), collection);

    expect(groups).toEqual([
      { source: 'github:matt711/mywebskills', ref: 'v1', skills: ['alpha', 'beta'] },
    ]);
  });

  it('collapses members that share a source and a ref into one call', () => {
    const groups = planMemberInstalls(
      manifestOf(
        ['acme/webtools', 'account-activity'],
        ['acme/webtools', 'portfolio'],
        ['acme/webtools', 'positions']
      ),
      collection
    );

    expect(groups).toEqual([
      { source: 'acme/webtools', skills: ['account-activity', 'portfolio', 'positions'] },
    ]);
  });

  it('keeps members from different repositories apart', () => {
    const groups = planMemberInstalls(
      manifestOf(['acme/webtools', 'account-activity'], ['.', 'local-skill']),
      collection
    );

    expect(groups).toEqual([
      { source: 'acme/webtools', skills: ['account-activity'] },
      { source: 'github:matt711/mywebskills', ref: 'v1', skills: ['local-skill'] },
    ]);
  });

  it('carries a member’s own ref, and installs the same repo at two refs separately', () => {
    const manifest: CollectionManifest = {
      ...manifestOf(['acme/webtools', 'account-activity'], ['acme/webtools', 'legacy']),
      skills: [
        { source: 'acme/webtools', skill: 'account-activity', ref: 'v2' },
        { source: 'acme/webtools', skill: 'legacy', ref: 'v1' },
      ],
    };

    const groups = planMemberInstalls(manifest, collection);

    expect(groups).toEqual([
      { source: 'acme/webtools', ref: 'v2', skills: ['account-activity'] },
      { source: 'acme/webtools', ref: 'v1', skills: ['legacy'] },
    ]);
  });

  it('treats github:owner/repo as the same repository as owner/repo', () => {
    const groups = planMemberInstalls(
      manifestOf(['acme/webtools', 'a'], ['github:acme/webtools', 'b']),
      collection
    );

    expect(groups).toEqual([{ source: 'acme/webtools', skills: ['a', 'b'] }]);
  });

  it('refuses a source it cannot install from, naming the skill', () => {
    expect(() => planMemberInstalls(manifestOf(['/tmp/webtools', 'a']), collection)).toThrow(
      /Skill "a" names the source "\/tmp\/webtools"/
    );
  });
});
