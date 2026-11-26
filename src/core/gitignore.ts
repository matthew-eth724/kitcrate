import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/** The managed block kitcrate writes so env files never reach a remote. */
const MANAGED_RULES = ['.env', '.env.*', '!.env.example'];

/** Marker comment identifying the managed block. */
const MANAGED_MARKER = '# kitcrate: environment files may contain secrets';

/** Outcome of ensuring the managed rules are present. */
export type GitignoreStatus = 'created' | 'appended' | 'unchanged';

/**
 * Ensure the collection repo ignores env files and credential files while still
 * allowing `.env.example` templates.
 *
 * The managed block is appended last so its `!.env.example` negation wins over
 * any earlier `.env.*` rule the author wrote.
 */
export async function ensureEnvIgnoreRules(dir: string): Promise<GitignoreStatus> {
  const path = join(dir, '.gitignore');

  let existing: string | undefined;
  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const block = [MANAGED_MARKER, ...MANAGED_RULES].join('\n');

  if (existing === undefined) {
    await writeFile(path, block + '\n', 'utf8');
    return 'created';
  }

  if (existing.includes(block)) {
    return 'unchanged';
  }

  // Replace a stale managed block if one is present, otherwise append.
  const markerIndex = existing.indexOf(MANAGED_MARKER);
  let base: string;
  if (markerIndex >= 0) {
    const afterMarker = existing.slice(markerIndex + MANAGED_MARKER.length);
    const markerEnd = afterMarker.indexOf('\n');
    base =
      existing.slice(0, markerIndex) + (markerEnd >= 0 ? afterMarker.slice(markerEnd + 1) : '');
  } else {
    base = existing;
  }

  const body = base.length === 0 ? '' : base.replace(/\n+$/, '') + '\n\n';
  await writeFile(path, body + block + '\n', 'utf8');
  return 'appended';
}
