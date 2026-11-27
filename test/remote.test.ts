import { describe, it, expect } from 'vitest';
import { chooseRemoteName } from '../src/core/remote.js';

/** Assert a name is chosen and return it. */
function chosen(taken: readonly string[]): string {
  const result = chooseRemoteName(taken);
  if (!result.ok) throw new Error(`expected a free remote name, got: ${result.reason}`);
  return result.name;
}

/** Assert no name is free and return the reason. */
function refused(taken: readonly string[]): string {
  const result = chooseRemoteName(taken);
  if (result.ok) throw new Error(`expected a refusal, got "${result.name}"`);
  return result.reason;
}

describe('chooseRemoteName', () => {
  it('prefers origin when the repository has no remote', () => {
    expect(chosen([])).toBe('origin');
  });

  it('prefers origin when other remotes are taken', () => {
    expect(chosen(['upstream'])).toBe('origin');
  });

  it('falls back to github when origin is taken', () => {
    expect(chosen(['origin'])).toBe('github');
  });

  it('falls back to github when origin is taken alongside other remotes', () => {
    expect(chosen(['origin', 'upstream'])).toBe('github');
  });

  it('refuses when neither origin nor github is free', () => {
    const reason = refused(['origin', 'github']);
    expect(reason).toContain('"origin"');
    expect(reason).toContain('"github"');
    expect(reason).toContain('git remote remove');
  });
});
