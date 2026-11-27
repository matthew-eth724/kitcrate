import { describe, it, expect } from 'vitest';
import { normalizeCollectionName } from '../src/core/name.js';

/** Assert a normalization succeeds and return the parsed name. */
function normalized(input: string): { name: string; changed: boolean } {
  const result = normalizeCollectionName(input);
  if (!result.ok) throw new Error(`expected "${input}" to normalize, got: ${result.reason}`);
  return { name: result.name, changed: result.changed };
}

/** Assert a normalization fails and return the reason. */
function rejected(input: string): string {
  const result = normalizeCollectionName(input);
  if (result.ok) throw new Error(`expected "${input}" to be rejected, got "${result.name}"`);
  return result.reason;
}

describe('normalizeCollectionName', () => {
  it('lowercases and hyphenates a space-separated name', () => {
    expect(normalized('Web Security')).toEqual({ name: 'web-security', changed: true });
  });

  it('lowercases an uppercase name', () => {
    expect(normalized('WEB-SECURITY')).toEqual({ name: 'web-security', changed: true });
  });

  it('collapses a run of spaces into one hyphen', () => {
    expect(normalized('web  security')).toEqual({ name: 'web-security', changed: true });
  });

  it('trims surrounding whitespace', () => {
    expect(normalized('  web-security  ')).toEqual({ name: 'web-security', changed: false });
  });

  it('strips leading and trailing hyphens', () => {
    expect(normalized('-web-security-')).toEqual({ name: 'web-security', changed: true });
  });

  it('collapses runs of hyphens', () => {
    expect(normalized('web---security')).toEqual({ name: 'web-security', changed: true });
  });

  it('leaves a valid name unchanged', () => {
    expect(normalized('web-security')).toEqual({ name: 'web-security', changed: false });
  });

  it('leaves a single-character name unchanged', () => {
    expect(normalized('a')).toEqual({ name: 'a', changed: false });
  });

  it('rejects an underscore and names it', () => {
    const reason = rejected('my_collection');
    expect(reason).toContain('"_"');
    expect(reason).toContain('lowercase letters, digits, and hyphens');
  });

  it('rejects a dot', () => {
    const reason = rejected('my.collection');
    expect(reason).toContain('"."');
  });

  it('rejects a slash and an at sign together', () => {
    const reason = rejected('my/collection@1');
    expect(reason).toContain('"/"');
    expect(reason).toContain('"@"');
  });

  it('rejects an empty name', () => {
    expect(rejected('')).toBe('Collection name must not be empty.');
  });

  it('rejects a name that is only whitespace or hyphens', () => {
    expect(rejected('   ')).toBe('Collection name must not be empty.');
    expect(rejected('---')).toBe('Collection name must not be empty.');
  });

  it('reports changed only when the name differs from the trimmed input', () => {
    expect(normalized(' web-security ').changed).toBe(false);
    expect(normalized('Web-Security').changed).toBe(true);
  });
});
