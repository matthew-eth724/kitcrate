import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { main } from '../src/cli.js';

/** Every command the CLI dispatches. */
const COMMANDS = ['add', 'install', 'update', 'remove', 'list', 'validate', 'create'] as const;

describe('kitcrate <command> --help', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Run the CLI and capture what it printed. */
  async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      out.push(parts.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
      err.push(parts.map(String).join(' '));
    });
    const code = await main(args);
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
  }

  for (const command of COMMANDS) {
    it(`prints the usage for \`kitcrate ${command} --help\``, async () => {
      const { code, stderr } = await run([command, '--help']);

      expect(code).toBe(0);
      expect(stderr).toContain(`Usage: kitcrate ${command}`);
    });

    it(`prints the usage for \`kitcrate ${command} -h\``, async () => {
      const { code, stderr } = await run([command, '-h']);

      expect(code).toBe(0);
      expect(stderr).toContain(`Usage: kitcrate ${command}`);
    });

    it(`does not run \`kitcrate ${command}\` when it is asked for help`, async () => {
      const { stdout } = await run([command, '--help']);

      // A command that ran would have produced its own output.
      expect(stdout).toBe('');
    });
  }

  it('reports an unknown command rather than treating it as a help request', async () => {
    const { code, stderr } = await run(['nope']);

    expect(code).toBe(1);
    expect(stderr).toContain('Unknown command: nope');
  });

  it('still asks for the argument a command needs', async () => {
    const { code, stderr } = await run(['add']);

    expect(code).toBe(1);
    expect(stderr).toContain('Usage: kitcrate add');
  });
});

describe('the entry point', () => {
  // The guard decides whether this module is the program the user started or
  // a module an importer loaded. It is only observable from another process:
  // in this one, import.meta.url names the test file. A package installed from
  // the registry runs through a symlink in node_modules/.bin, so that is the
  // case worth proving — it is the one that once made the published CLI do
  // nothing at all.
  it('runs when the built bundle is reached through a symlink', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kitcrate-entry-'));
    const bundle = join(process.cwd(), 'dist', 'cli.js');
    const link = join(dir, 'kitcrate');
    try {
      symlinkSync(bundle, link);
      const run = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(run.stderr).toContain('Usage: kitcrate');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
