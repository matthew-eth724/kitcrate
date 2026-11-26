import { describe, it, expect } from 'vitest';
import { computeManifestHash } from '../src/core/hash.js';

describe('computeManifestHash', () => {
  it('produces a sha256-prefixed hash over the manifest bytes', () => {
    const manifest = JSON.stringify({
      name: 'test',
      version: '1.0.0',
      description: 'x',
      skills: [],
    });
    const hash = computeManifestHash(manifest);
    expect(hash).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it('produces the same hash for identical input', () => {
    const manifest = JSON.stringify({
      name: 'test',
      version: '1.0.0',
      description: 'x',
      skills: [],
    });
    expect(computeManifestHash(manifest)).toBe(computeManifestHash(manifest));
  });

  it('produces different hashes for different input', () => {
    const a = computeManifestHash(JSON.stringify({ name: 'a' }));
    const b = computeManifestHash(JSON.stringify({ name: 'b' }));
    expect(a).not.toBe(b);
  });

  it('accepts Buffer input', () => {
    const str = JSON.stringify({ name: 'test', version: '1.0.0', description: 'x', skills: [] });
    const buf = Buffer.from(str, 'utf8');
    expect(computeManifestHash(str)).toBe(computeManifestHash(buf));
  });
});
