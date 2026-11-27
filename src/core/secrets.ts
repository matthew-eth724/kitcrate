import { readdir, readFile, stat } from 'fs/promises';
import { basename, join, relative } from 'path';
import { listTrackedFiles, unstagePath } from '../git/index.js';

/** A secret found while scanning. */
export interface SecretFinding {
  /** Path relative to the scanned root. */
  readonly path: string;
  /** What kind of secret was detected. */
  readonly kind: SecretKind;
  /** Human-readable description. */
  readonly message: string;
}

/** Categories of secret kitcrate blocks before publishing. */
export type SecretKind = 'env-file' | 'private-key' | 'api-key' | 'credential-file';

/** Result of a secret scan. */
export interface SecretScanResult {
  /** Findings, sorted by path. */
  readonly findings: readonly SecretFinding[];
  /** True when nothing suspicious was found. */
  readonly clean: boolean;
}

/** Patterns for common API key formats. */
const API_KEY_PATTERNS: readonly {
  readonly kind: SecretKind;
  readonly pattern: RegExp;
  readonly message: string;
}[] = [
  {
    kind: 'api-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    message: 'AWS access key ID',
  },
  {
    kind: 'api-key',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    message: 'GitHub token',
  },
  {
    kind: 'api-key',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    message: 'Slack token',
  },
  {
    kind: 'api-key',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/,
    message: 'OpenAI-style secret key',
  },
  {
    kind: 'api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    message: 'Google API key',
  },
  {
    kind: 'api-key',
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
    message: 'npm token',
  },
];

/** Private key file headers. */
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/;

/** File names that always count as credential files. */
const CREDENTIAL_FILE_NAMES = new Set(['.netrc', '.npmrc', '.pypirc', 'credentials', '.htpasswd']);

/** The one env file that is safe to publish: a template with placeholder values. */
const ALLOWED_ENV_FILE = '.env.example';

/**
 * True when a file name is an env file that must never be published.
 * `.env` and `.env.<variant>` hold real values; `.env.example` is a template.
 */
export function isEnvFileName(name: string): boolean {
  return name === '.env' || (name.startsWith('.env.') && name !== ALLOWED_ENV_FILE);
}

/** True when a file name is a credential file that must never reach a remote. */
export function isCredentialFileName(name: string): boolean {
  return CREDENTIAL_FILE_NAMES.has(name) || isEnvFileName(name);
}

/** Directories never scanned. */
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);

/** Maximum file size to scan (1MB). Larger files are skipped. */
const MAX_SCAN_BYTES = 1024 * 1024;

/** Scan a directory tree for secrets. */
export async function scanForSecrets(root: string): Promise<SecretScanResult> {
  const findings: SecretFinding[] = [];
  await scanDirectory(root, root, findings);
  findings.sort((a, b) => a.path.localeCompare(b.path));
  return { findings, clean: findings.length === 0 };
}

async function scanDirectory(root: string, dir: string, findings: SecretFinding[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(root, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      await scanDirectory(root, fullPath, findings);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    // .env and .env.<variant> files contain real secrets and are blocked.
    // .env.example is a template without secrets and is allowed.
    if (isEnvFileName(entry.name)) {
      findings.push({
        path: relPath,
        kind: 'env-file',
        message: `Environment file (${entry.name})`,
      });
      continue;
    }

    if (CREDENTIAL_FILE_NAMES.has(entry.name)) {
      findings.push({
        path: relPath,
        kind: 'credential-file',
        message: `Credential file (${entry.name})`,
      });
      continue;
    }

    await scanFile(fullPath, relPath, findings);
  }
}

async function scanFile(
  fullPath: string,
  relPath: string,
  findings: SecretFinding[]
): Promise<void> {
  let contents: string;
  try {
    const stats = await stat(fullPath);
    if (stats.size > MAX_SCAN_BYTES) {
      return;
    }
    contents = await readFile(fullPath, 'utf8');
  } catch {
    return;
  }

  if (PRIVATE_KEY_PATTERN.test(contents)) {
    findings.push({
      path: relPath,
      kind: 'private-key',
      message: 'Private key material',
    });
  }

  for (const { kind, pattern, message } of API_KEY_PATTERNS) {
    if (pattern.test(contents)) {
      findings.push({ path: relPath, kind, message });
    }
  }
}

/**
 * Scan a specific set of files for secret patterns in their contents.
 * Used to gate publishing on exactly the files that would be pushed.
 */
export async function scanFilesForSecrets(
  root: string,
  relativePaths: readonly string[]
): Promise<SecretScanResult> {
  const findings: SecretFinding[] = [];
  for (const relPath of relativePaths) {
    await scanFile(join(root, relPath), relPath, findings);
  }
  findings.sort((a, b) => a.path.localeCompare(b.path));
  return { findings, clean: findings.length === 0 };
}

/**
 * Remove credential files from a repository's git index so they stay on disk
 * but are never pushed, and report which paths were excluded.
 *
 * This is the publish gate both `create` and `publish` run: the exclusion is
 * what keeps a credential out of the remote, so it belongs beside the rules
 * that decide what a credential is.
 */
export async function excludeCredentialFiles(repoDir: string): Promise<string[]> {
  const tracked = await listTrackedFiles(repoDir);
  const credentialFiles = tracked.filter((path) => isCredentialFileName(basename(path)));
  for (const path of credentialFiles) {
    await unstagePath(repoDir, path);
  }
  return credentialFiles;
}
