import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateCommand } from '../src/commands/validate.js';
import type { CommandOptions } from '../src/core/options.js';

// The remote path resolves a repository over the network. The owner/repo
// member that must still warn is redirected so the test never reaches the
// network. A `.` member never calls resolveCollection, so this mock does not
// touch the local case.
vi.mock('../src/core/resolve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/resolve.js')>();
  return {
    ...actual,
    resolveCollection: vi.fn(async (source: string) => {
      if (source === 'acme/never-exists') {
        throw new Error('cannot reach the repository');
      }
      return actual.resolveCollection(source);
    }),
  };
});

/**
 * A `.` member is the collection's own skill: `kitcrate create` writes it for
 * a skill that lives in the collection itself. Until this feature, `validate`
 * tried to resolve a bare `.` as a repository, warned on every collection this
 * tool publishes, and never understood that the skill sits beside the
 * collection.json it was given.
 */
describe('validateCommand with a . member', () => {
  let dir: string;
  const options: CommandOptions = { yes: false, json: false, debug: false, global: false };

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function writeCollection(skills: unknown[]): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'kitcrate-validate-'));
    const manifest = {
      name: 'web-security',
      version: '0.1.0',
      description: 'Web app security review skills',
      skills,
    };
    await writeFile(join(dir, 'collection.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return join(dir, 'collection.json');
  }

  /** Run validate, capturing what it prints. */
  async function run(path: string): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) =>
      out.push(a.map(String).join(' '))
    );
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) =>
      err.push(a.map(String).join(' '))
    );
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) =>
      err.push(a.map(String).join(' '))
    );
    const code = await validateCommand([path], options);
    return { code, out, err };
  }

  it('validates a . member with no warning', async () => {
    const path = await writeCollection([{ source: '.', skill: 'account-activity' }]);
    const { code, err } = await run(path);
    expect(code).toBe(0);
    expect(err.join('\n')).not.toContain('Could not resolve source');
  });

  it('still warns when a non-local source cannot be resolved', async () => {
    // An owner/repo member is resolved from the network as before. A
    // repository that cannot be reached warns, so the remote path is
    // untouched.
    const path = await writeCollection([{ source: 'acme/never-exists', skill: 'xss-review' }]);
    const { code, err } = await run(path);
    expect(code).toBe(0);
    expect(err.join('\n')).toContain('Could not resolve source "acme/never-exists"');
  });
});
