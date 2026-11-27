import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCollectionManifest } from '../src/core/manifest.js';
import {
  buildPublishedManifest,
  bumpPatchVersion,
  chooseMemberParent,
  copySkillFolder,
  diffSkillFolders,
  findMemberFolders,
  isCopyableFile,
  type CollectionMember,
} from '../src/core/publish-plan.js';

/** Write a skill folder: a SKILL.md naming `name`, plus any extra files. */
async function writeSkill(
  dir: string,
  name: string,
  extra: Readonly<Record<string, string>> = {}
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n# ${name}\n`,
    'utf8'
  );
  for (const [path, contents] of Object.entries(extra)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
}

describe('publish helpers', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kitcrate-publish-plan-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('diffSkillFolders', () => {
    it('reports no change for identical folders', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha', { 'references/api.md': '# api\n' });
      await writeSkill(join(root, 'repo', 'alpha'), 'alpha', { 'references/api.md': '# api\n' });

      expect(
        await diffSkillFolders(join(root, 'local', 'alpha'), join(root, 'repo', 'alpha'))
      ).toEqual({ changed: false, changedFiles: [] });
    });

    it('reports the file whose contents differ', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha');
      await writeSkill(join(root, 'repo', 'alpha'), 'alpha');
      await writeFile(join(root, 'local', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nrevised\n');

      const diff = await diffSkillFolders(
        join(root, 'local', 'alpha'),
        join(root, 'repo', 'alpha')
      );

      expect(diff).toEqual({ changed: true, changedFiles: ['SKILL.md'] });
    });

    it('reports a file the repository copy does not have', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha', { 'scripts/run.sh': '#!/bin/sh\n' });
      await writeSkill(join(root, 'repo', 'alpha'), 'alpha');

      expect(
        await diffSkillFolders(join(root, 'local', 'alpha'), join(root, 'repo', 'alpha'))
      ).toEqual({ changed: true, changedFiles: ['scripts/run.sh'] });
    });

    it('reports a file the local copy does not have', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha');
      await writeSkill(join(root, 'repo', 'alpha'), 'alpha', { 'assets/diagram.svg': '<svg/>\n' });

      expect(
        await diffSkillFolders(join(root, 'local', 'alpha'), join(root, 'repo', 'alpha'))
      ).toEqual({ changed: true, changedFiles: ['assets/diagram.svg'] });
    });

    it('treats a missing folder as empty instead of throwing', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha');

      const diff = await diffSkillFolders(
        join(root, 'local', 'alpha'),
        join(root, 'repo', 'alpha')
      );

      expect(diff.changed).toBe(true);
      expect(diff.changedFiles).toEqual(['SKILL.md']);
    });

    it('ignores a nested .git directory', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha');
      await writeSkill(join(root, 'repo', 'alpha'), 'alpha');
      await mkdir(join(root, 'local', 'alpha', '.git'), { recursive: true });
      await writeFile(join(root, 'local', 'alpha', '.git', 'HEAD'), 'ref: refs/heads/main\n');

      expect(
        await diffSkillFolders(join(root, 'local', 'alpha'), join(root, 'repo', 'alpha'))
      ).toEqual({ changed: false, changedFiles: [] });
    });
  });

  describe('findMemberFolders', () => {
    it('finds each own member by the name its SKILL.md declares', async () => {
      await writeSkill(join(root, 'skills', 'xss-folder'), 'xss-review');
      await writeSkill(join(root, 'other', 'sqli-review'), 'sqli-review');
      const members: CollectionMember[] = [
        { skill: 'xss-review', source: '.' },
        { skill: 'sqli-review', source: '.' },
      ];

      expect(await findMemberFolders(root, members)).toEqual(
        new Map([
          ['sqli-review', 'other/sqli-review'],
          ['xss-review', 'skills/xss-folder'],
        ])
      );
    });

    it('finds a member from another repository too, so its difference can be reported', async () => {
      await writeSkill(join(root, 'skills', 'burp-notes'), 'burp-notes');
      const members: CollectionMember[] = [
        { skill: 'burp-notes', source: 'acme/shared-skills' },
        // A member whose folder the repository does not hold at all.
        { skill: 'gone', source: '.' },
      ];

      expect(await findMemberFolders(root, members)).toEqual(
        new Map([['burp-notes', 'skills/burp-notes']])
      );
    });

    it('takes a folder the caller already knows over searching for it', async () => {
      await writeSkill(join(root, 'skills', 'alpha'), 'alpha');
      const members: CollectionMember[] = [
        { skill: 'alpha', source: '.', repoPath: 'copied/alpha' },
      ];

      expect(await findMemberFolders(root, members)).toEqual(new Map([['alpha', 'copied/alpha']]));
    });
  });

  describe('chooseMemberParent', () => {
    it('uses the parent the own members share', async () => {
      await mkdir(join(root, 'skills', 'alpha'), { recursive: true });
      const members: CollectionMember[] = [
        { skill: 'alpha', source: '.', repoPath: 'skills/alpha' },
        { skill: 'beta', source: '.', repoPath: 'skills/beta' },
      ];

      expect(await chooseMemberParent(root, members)).toBe('skills');
    });

    it('ignores members installed from another repository', async () => {
      await mkdir(join(root, 'skills'), { recursive: true });
      const members: CollectionMember[] = [
        { skill: 'alpha', source: '.', repoPath: 'skills/alpha' },
        { skill: 'remote', source: 'acme/shared-skills', repoPath: 'elsewhere/remote' },
      ];

      expect(await chooseMemberParent(root, members)).toBe('skills');
    });

    it('falls back to skills when the own members share no parent', async () => {
      await mkdir(join(root, 'a', 'alpha'), { recursive: true });
      await mkdir(join(root, 'b', 'beta'), { recursive: true });
      const members: CollectionMember[] = [
        { skill: 'alpha', source: '.', repoPath: 'a/alpha' },
        { skill: 'beta', source: '.', repoPath: 'b/beta' },
      ];

      expect(await chooseMemberParent(root, members)).toBe('skills');
    });

    it('falls back to skills when the collection has no members', async () => {
      expect(await chooseMemberParent(root, [])).toBe('skills');
    });

    it('falls back to skills when the members sit at the repository root', async () => {
      const members: CollectionMember[] = [{ skill: 'alpha', source: '.', repoPath: 'alpha' }];

      expect(await chooseMemberParent(root, members)).toBe('skills');
    });
  });

  describe('bumpPatchVersion', () => {
    it('raises the patch number', () => {
      expect(bumpPatchVersion('0.1.0')).toBe('0.1.1');
      expect(bumpPatchVersion('1.2.9')).toBe('1.2.10');
      expect(bumpPatchVersion('2.0.0')).toBe('2.0.1');
    });

    it('drops a pre-release suffix, which the published change supersedes', () => {
      expect(bumpPatchVersion('0.1.0-beta.1')).toBe('0.1.1');
    });

    it('refuses a version that is not semver', () => {
      expect(() => bumpPatchVersion('v1')).toThrow(/expected a semver version/);
    });
  });

  describe('buildPublishedManifest', () => {
    const manifest = parseCollectionManifest({
      name: 'web-security',
      version: '0.1.0',
      description: 'Web app security review skills',
      skills: [
        { source: '.', skill: 'xss-review' },
        { source: 'acme/shared-skills', skill: 'burp-notes' },
      ],
    });

    it('adds the chosen skills as members of this collection and bumps the version', () => {
      const published = buildPublishedManifest(manifest, ['sqli-checks']);

      expect(published.version).toBe('0.1.1');
      expect(published.skills).toEqual([
        { source: '.', skill: 'xss-review' },
        { source: 'acme/shared-skills', skill: 'burp-notes' },
        { source: '.', skill: 'sqli-checks' },
      ]);
      // The existing members keep their own sources.
      expect(published.skills[1]).toEqual({ source: 'acme/shared-skills', skill: 'burp-notes' });
    });

    it('leaves the name and description alone', () => {
      const published = buildPublishedManifest(manifest, ['sqli-checks']);

      expect(published.name).toBe('web-security');
      expect(published.description).toBe('Web app security review skills');
    });

    it('does not list a skill twice when it is already a member', () => {
      const published = buildPublishedManifest(manifest, ['xss-review', 'xss-review']);

      expect(published.skills.filter((member) => member.skill === 'xss-review')).toHaveLength(1);
    });

    it('bumps the version even when nothing is added', () => {
      expect(buildPublishedManifest(manifest, []).version).toBe('0.1.1');
    });
  });

  describe('copySkillFolder', () => {
    it('copies the whole folder, references and assets included', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha', {
        'references/api.md': '# api\n',
        'assets/table.csv': 'a,b\n',
      });

      const copied = await copySkillFolder(
        join(root, 'local', 'alpha'),
        join(root, 'repo', 'skills', 'alpha')
      );

      expect(copied.map((file) => file.path).sort()).toEqual([
        'SKILL.md',
        'assets/table.csv',
        'references/api.md',
      ]);
      expect(
        await readFile(join(root, 'repo', 'skills', 'alpha', 'references', 'api.md'), 'utf8')
      ).toBe('# api\n');
    });

    it('replaces the repository folder, dropping a file the local copy no longer has', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha');
      await writeSkill(join(root, 'repo', 'alpha'), 'alpha', { 'references/old.md': 'gone\n' });

      await copySkillFolder(join(root, 'local', 'alpha'), join(root, 'repo', 'alpha'));

      await expect(
        readFile(join(root, 'repo', 'alpha', 'references', 'old.md'), 'utf8')
      ).rejects.toThrow(/ENOENT/);
    });

    it('leaves credential files behind and keeps the env template', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha', {
        '.env': 'TOKEN=secret\n',
        '.env.example': 'TOKEN=\n',
        '.netrc': 'machine github.com\n',
      });

      const copied = await copySkillFolder(
        join(root, 'local', 'alpha'),
        join(root, 'repo', 'alpha')
      );

      expect(copied.map((file) => file.path).sort()).toEqual(['.env.example', 'SKILL.md']);
    });

    it('copies nothing from a nested .git', async () => {
      await writeSkill(join(root, 'local', 'alpha'), 'alpha');
      await mkdir(join(root, 'local', 'alpha', '.git'), { recursive: true });
      await writeFile(join(root, 'local', 'alpha', '.git', 'HEAD'), 'ref: refs/heads/main\n');

      const copied = await copySkillFolder(
        join(root, 'local', 'alpha'),
        join(root, 'repo', 'alpha')
      );

      expect(copied.map((file) => file.path)).toEqual(['SKILL.md']);
    });
  });

  describe('isCopyableFile', () => {
    it('refuses credential files and allows the env template', () => {
      expect(isCopyableFile('.env')).toBe(false);
      expect(isCopyableFile('config/.env.local')).toBe(false);
      expect(isCopyableFile('.netrc')).toBe(false);
      expect(isCopyableFile('.npmrc')).toBe(false);
      expect(isCopyableFile('.env.example')).toBe(true);
      expect(isCopyableFile('SKILL.md')).toBe(true);
    });
  });
});
