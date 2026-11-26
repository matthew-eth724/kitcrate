import { describe, it, expect } from 'vitest';
import {
  parseCollectionManifest,
  safeParseCollectionManifest,
  type CollectionManifest,
} from '../src/core/manifest.js';

const validManifest: CollectionManifest = {
  name: 'web-security',
  version: '1.2.0',
  description: 'Web app security review skills',
  skills: [
    { source: 'acme/web-security', skill: 'xss-review' },
    { source: 'acme/web-security', skill: 'sqli-checks' },
    { source: 'other/shared-skills', skill: 'burp-notes', ref: 'v2' },
  ],
};

describe('parseCollectionManifest', () => {
  it('accepts a valid manifest', () => {
    const result = parseCollectionManifest(validManifest);
    expect(result.name).toBe('web-security');
    expect(result.version).toBe('1.2.0');
    expect(result.skills).toHaveLength(3);
  });

  it('rejects missing name', () => {
    expect(() => parseCollectionManifest({ ...validManifest, name: '' })).toThrow();
  });

  it('rejects invalid name format', () => {
    expect(() => parseCollectionManifest({ ...validManifest, name: 'Web Security' })).toThrow();
    expect(() => parseCollectionManifest({ ...validManifest, name: '-invalid' })).toThrow();
    expect(() => parseCollectionManifest({ ...validManifest, name: 'invalid-' })).toThrow();
  });

  it('rejects missing version', () => {
    expect(() => parseCollectionManifest({ ...validManifest, version: '' })).toThrow();
  });

  it('rejects non-semver version', () => {
    expect(() => parseCollectionManifest({ ...validManifest, version: '1.2' })).toThrow();
    expect(() => parseCollectionManifest({ ...validManifest, version: 'v1.2.0' })).toThrow();
  });

  it('rejects empty skills array', () => {
    expect(() => parseCollectionManifest({ ...validManifest, skills: [] })).toThrow();
  });

  it('rejects skill with path traversal', () => {
    expect(() =>
      parseCollectionManifest({
        ...validManifest,
        skills: [{ source: 'acme/repo', skill: '../evil' }],
      })
    ).toThrow();
  });

  it('rejects source with URL', () => {
    expect(() =>
      parseCollectionManifest({
        ...validManifest,
        skills: [{ source: 'https://evil.com/repo', skill: 'x' }],
      })
    ).toThrow();
  });

  describe('safeParseCollectionManifest', () => {
    it('returns success for valid input', () => {
      const result = safeParseCollectionManifest(validManifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('web-security');
      }
    });

    it('returns failure for invalid input', () => {
      const result = safeParseCollectionManifest({
        name: '',
        version: '',
        description: '',
        skills: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toBeDefined();
      }
    });
  });
});
