import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureReleaseTag, isKitcrateSubject } from '../src/core/release.js';
import { git } from '../src/git/index.js';

describe('release tag', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kitcrate-release-'));
    await git(['init'], root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Commit a file so the repository has a commit the test can tag. */
  async function commitAll(message: string): Promise<string> {
    await writeFile(join(root, 'collection.json'), `{"at":"${message}"}\n`, 'utf8');
    await git(['add', '--', 'collection.json'], root);
    await git(['commit', '-m', message], root);
    return (await git(['rev-parse', 'HEAD'], root)).stdout.trim();
  }

  /** The commit a tag points at. */
  async function tagCommit(tag: string): Promise<string | null> {
    const result = await git(['rev-list', '-n', '1', tag], root);
    return result.code === 0 ? result.stdout.trim() : null;
  }

  it('recognises both subjects kitcrate writes', () => {
    expect(isKitcrateSubject('chore: initial collection web-security v0.1.0')).toBe(true);
    expect(isKitcrateSubject('chore: collection web-security v0.1.1')).toBe(true);
    expect(isKitcrateSubject('a commit of the author own')).toBe(false);
  });

  it('tags the commit this run made', async () => {
    const head = await commitAll('chore: collection web-security v0.1.1');

    expect(await ensureReleaseTag(root, 'v0.1.1')).toEqual({ ok: true, moved: false });
    expect(await tagCommit('v0.1.1')).toBe(head);
  });

  it('leaves a tag that already points at this commit alone', async () => {
    const head = await commitAll('chore: collection web-security v0.1.1');
    await git(['tag', 'v0.1.1'], root);

    expect(await ensureReleaseTag(root, 'v0.1.1')).toEqual({ ok: true, moved: false });
    expect(await tagCommit('v0.1.1')).toBe(head);
  });

  it('moves a tag kitcrate made on an older commit, whichever subject it wrote', async () => {
    const earlier = await commitAll('chore: initial collection web-security v0.1.0');
    await git(['tag', 'v0.1.0'], root);
    const head = await commitAll('chore: collection web-security v0.1.1');

    // The tag being asked for is the release the older commit carries.
    await git(['tag', '-f', 'v0.1.1', earlier], root);
    expect(await tagCommit('v0.1.1')).toBe(earlier);

    expect(await ensureReleaseTag(root, 'v0.1.1')).toEqual({ ok: true, moved: true });
    expect(await tagCommit('v0.1.1')).toBe(head);
  });

  it('refuses to move a tag kitcrate did not make, and says what to do', async () => {
    const earlier = await commitAll('a commit of the author own');
    await git(['tag', 'v0.1.1'], root);
    const head = await commitAll('chore: collection web-security v0.1.2');

    const result = await ensureReleaseTag(root, 'v0.1.1');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toContain('kitcrate did not make that tag');
    expect(result.reason).toContain(`git tag -f v0.1.1`);
    // The author's tag is left exactly where it was.
    expect(await tagCommit('v0.1.1')).toBe(earlier);
    expect(await tagCommit('v0.1.1')).not.toBe(head);
  });
});
