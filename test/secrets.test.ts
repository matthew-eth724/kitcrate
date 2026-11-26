import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { isCredentialFileName, isEnvFileName, scanForSecrets } from '../src/core/secrets.js';

describe('scanForSecrets', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function setupDir(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'kitcrate-secret-test-'));
    return dir;
  }

  it('returns clean for an empty directory', async () => {
    await setupDir();
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('detects .env files', async () => {
    await setupDir();
    await writeFile(join(dir, '.env'), 'SECRET=abc123', 'utf8');
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.kind === 'env-file' && f.path === '.env')).toBe(true);
  });

  it('detects .env.production files', async () => {
    await setupDir();
    await writeFile(join(dir, '.env.production'), 'SECRET=abc', 'utf8');
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.kind === 'env-file')).toBe(true);
  });

  it('allows .env.example files', async () => {
    await setupDir();
    await writeFile(join(dir, '.env.example'), 'SECRET=example', 'utf8');
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(true);
    expect(result.findings.some((f) => f.kind === 'env-file')).toBe(false);
  });

  it('detects private keys', async () => {
    await setupDir();
    await writeFile(
      join(dir, 'key.pem'),
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
      'utf8'
    );
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.kind === 'private-key')).toBe(true);
  });

  it('detects AWS access keys', async () => {
    await setupDir();
    await writeFile(join(dir, 'config.ts'), 'const key = "AKIAIOSFODNN7EXAMPLE";', 'utf8');
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.kind === 'api-key')).toBe(true);
  });

  it('detects GitHub tokens', async () => {
    await setupDir();
    await writeFile(
      join(dir, 'config.ts'),
      'const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDE";',
      'utf8'
    );
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.kind === 'api-key')).toBe(true);
  });

  it('detects OpenAI-style keys', async () => {
    await setupDir();
    await writeFile(
      join(dir, 'config.ts'),
      'const key = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDE";',
      'utf8'
    );
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.kind === 'api-key')).toBe(true);
  });

  it('ignores .git directory', async () => {
    await setupDir();
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, '.git', 'config'), 'token = "AKIAIOSFODNN7EXAMPLE"', 'utf8');
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(true);
  });

  it('ignores node_modules directory', async () => {
    await setupDir();
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(
      join(dir, 'node_modules', 'pkg', 'secret.js'),
      'const key = "sk-12345678901234567890123456789012";',
      'utf8'
    );
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(true);
  });

  it('sorts findings by path', async () => {
    await setupDir();
    await writeFile(join(dir, '.env.b'), 'x=1', 'utf8');
    await writeFile(join(dir, '.env.a'), 'y=2', 'utf8');
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(false);
    expect(result.findings[0].path).toBe('.env.a');
    expect(result.findings[1].path).toBe('.env.b');
  });

  it('detects credential files (.netrc, .npmrc)', async () => {
    await setupDir();
    await writeFile(join(dir, '.netrc'), 'machine example.com login user password pass', 'utf8');
    await writeFile(join(dir, '.npmrc'), '//registry.npmjs.org/:_authToken=abc', 'utf8');
    const result = await scanForSecrets(dir);
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.kind === 'credential-file')).toBe(true);
  });
});

describe('credential file predicates', () => {
  it('treats .env as a credential file', () => {
    expect(isEnvFileName('.env')).toBe(true);
    expect(isCredentialFileName('.env')).toBe(true);
  });

  it('treats .env.<variant> as a credential file', () => {
    expect(isEnvFileName('.env.production')).toBe(true);
    expect(isEnvFileName('.env.local')).toBe(true);
    expect(isCredentialFileName('.env.production')).toBe(true);
  });

  it('treats .env.example as publishable', () => {
    expect(isEnvFileName('.env.example')).toBe(false);
    expect(isCredentialFileName('.env.example')).toBe(false);
  });

  it('treats known credential files as credential files', () => {
    for (const name of ['.netrc', '.npmrc', '.pypirc', 'credentials', '.htpasswd']) {
      expect(isCredentialFileName(name)).toBe(true);
    }
  });

  it('treats ordinary files as publishable', () => {
    expect(isCredentialFileName('SKILL.md')).toBe(false);
    expect(isCredentialFileName('README.md')).toBe(false);
    expect(isCredentialFileName('collection.json')).toBe(false);
  });
});
