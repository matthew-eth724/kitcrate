import { describe, expect, it } from 'vitest';
import { checkTools, missingToolsMessage, type Tool } from '../src/core/tools.js';

/** A probe that reports a fixed set of tools as present. */
function probeWith(present: readonly Tool[]) {
  return async (tool: Tool): Promise<boolean> => present.includes(tool);
}

describe('tool preflight', () => {
  it('lets a command through when every tool it needs is there', async () => {
    const check = await checkTools('publish', probeWith(['git', 'gh']));
    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
    expect(missingToolsMessage('publish', check)).toBeNull();
  });

  it('names both tools when neither is installed', async () => {
    const check = await checkTools('create', probeWith([]));
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(['git', 'gh']);
  });

  it('names only gh when a publish has git but not gh', async () => {
    const check = await checkTools('publish', probeWith(['git']));
    expect(check.missing).toEqual(['gh']);
    const message = missingToolsMessage('publish', check);
    expect(message).toContain('gh');
    expect(message).not.toContain('- git');
  });

  it('needs git alone for add, install, update and remove', async () => {
    for (const command of ['add', 'install', 'update', 'remove']) {
      const check = await checkTools(command, probeWith(['gh']));
      expect(check.missing).toEqual(['git']);
    }
  });

  it('needs nothing for list and validate', async () => {
    for (const command of ['list', 'validate']) {
      const check = await checkTools(command, probeWith([]));
      expect(check.ok).toBe(true);
      expect(check.missing).toEqual([]);
    }
  });

  it('needs nothing for an unknown command, which the dispatcher reports', async () => {
    const check = await checkTools('nope', probeWith([]));
    expect(check.ok).toBe(true);
  });

  it('says which tool, why, and how to get it', async () => {
    const check = await checkTools('create', probeWith(['git']));
    const message = missingToolsMessage('create', check);
    expect(message).toContain('cannot run');
    expect(message).toContain('gh');
    expect(message).toContain('create the GitHub repository');
    expect(message).toContain('https://cli.github.com');
  });
});
