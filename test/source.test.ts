import { describe, expect, it } from 'vitest';
import { displaySource, githubOwnerRepo } from '../src/core/source.js';

describe('githubOwnerRepo', () => {
  it('accepts owner/repo as it is', () => {
    expect(githubOwnerRepo('acme/webtools')).toBe('acme/webtools');
    expect(githubOwnerRepo('matt711/mywebskills')).toBe('matt711/mywebskills');
  });

  it('accepts the github: prefix', () => {
    expect(githubOwnerRepo('github:acme/webtools')).toBe('acme/webtools');
  });

  it('accepts an https URL, with or without the .git suffix', () => {
    expect(githubOwnerRepo('https://github.com/acme/webtools')).toBe('acme/webtools');
    expect(githubOwnerRepo('https://github.com/acme/webtools.git')).toBe('acme/webtools');
    expect(githubOwnerRepo('https://www.github.com/acme/webtools.git')).toBe('acme/webtools');
  });

  it('accepts a git ssh URL', () => {
    expect(githubOwnerRepo('git@github.com:acme/webtools.git')).toBe('acme/webtools');
    expect(githubOwnerRepo('ssh://git@github.com/acme/webtools.git')).toBe('acme/webtools');
  });

  it('drops a trailing ref', () => {
    expect(githubOwnerRepo('https://github.com/acme/webtools.git@v1.2.0')).toBe('acme/webtools');
    expect(githubOwnerRepo('github:acme/webtools@v1')).toBe('acme/webtools');
  });

  it('trims surrounding whitespace', () => {
    expect(githubOwnerRepo('  acme/webtools  ')).toBe('acme/webtools');
  });

  it('returns null for a source that is not a GitHub repository', () => {
    for (const source of [
      '/tmp/collection',
      './skills',
      '../skills',
      '~/skills',
      'file:///tmp/collection',
      'https://gitlab.com/acme/webtools.git',
      'git@gitlab.com:acme/webtools.git',
      'acme',
      '',
      'acme/..',
    ]) {
      expect(githubOwnerRepo(source)).toBeNull();
    }
  });
});

describe('displaySource', () => {
  it('shows a GitHub source as owner/repo', () => {
    expect(displaySource('github:acme/webtools')).toBe('acme/webtools');
    expect(displaySource('https://github.com/acme/webtools.git')).toBe('acme/webtools');
    expect(displaySource('git@github.com:acme/webtools.git')).toBe('acme/webtools');
    expect(displaySource('acme/webtools')).toBe('acme/webtools');
  });

  it('leaves a source it cannot express as owner/repo unchanged', () => {
    expect(displaySource('/tmp/collection')).toBe('/tmp/collection');
    expect(displaySource('https://gitlab.com/acme/webtools.git')).toBe(
      'https://gitlab.com/acme/webtools.git'
    );
  });
});
