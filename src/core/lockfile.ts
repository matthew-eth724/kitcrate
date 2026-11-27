import { readFile, rename, unlink, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { z } from 'zod';

/** Current lockfile format version. */
export const LOCKFILE_VERSION = 1;

/** Path to the kitcrate lockfile (in the consumer's project). */
export const LOCKFILE_NAME = 'kitcrate-lock.json';

/** A single installed collection's lock entry. */
export const CollectionLockEntrySchema = z.object({
  /** Normalized source identifier (e.g. github:acme/web-security). */
  source: z.string().min(1),
  /** Ref used to resolve the collection (branch/tag/commit). */
  ref: z.string().min(1),
  /**
   * Pinned commit SHA of the resolved collection.json. Empty for a local source
   * that is not a git repository, so there is no commit to pin.
   */
  commit: z.string(),
  /** Hash of the collection.json that was resolved. */
  manifestHash: z.string().min(1),
  /** Optional filter: only these member skills were installed. */
  only: z.array(z.string().min(1)).optional(),
  /** Member skills installed by this collection, by name only. */
  skills: z.array(z.string().min(1)),
  /** Member skills that were already installed when the collection was added. */
  preexisting: z.array(z.string().min(1)).default([]),
  /** Where the collection's skills are installed. */
  scope: z.enum(['project', 'global']).default('project'),
});

export type CollectionLockEntry = z.infer<typeof CollectionLockEntrySchema>;

/** Full lockfile schema. */
export const LockfileSchema = z.object({
  version: z.literal(LOCKFILE_VERSION),
  collections: z.record(CollectionLockEntrySchema),
});

export type Lockfile = z.infer<typeof LockfileSchema>;

/** Lockfile parse error with a clear message for unknown versions. */
export class LockfileVersionError extends Error {
  constructor(readonly found: unknown) {
    super(
      `Unknown kitcrate-lock.json version: ${JSON.stringify(found)}. Expected ${LOCKFILE_VERSION}.`
    );
    this.name = 'LockfileVersionError';
  }
}

/** Read and validate a kitcrate-lock.json file. */
export async function readLockfile(cwd: string): Promise<Lockfile> {
  const path = join(cwd, LOCKFILE_NAME);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: LOCKFILE_VERSION, collections: {} };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${LOCKFILE_NAME}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    throw new Error(`Malformed ${LOCKFILE_NAME}: missing version field.`);
  }

  const version = (parsed as { version: unknown }).version;
  if (version !== LOCKFILE_VERSION) {
    throw new LockfileVersionError(version);
  }

  return LockfileSchema.parse(parsed);
}

/** Write a lockfile atomically with sorted keys and trailing newline. */
export async function writeLockfile(cwd: string, lockfile: Lockfile): Promise<void> {
  const path = join(cwd, LOCKFILE_NAME);
  const sorted = sortLockfile(lockfile);
  const content = JSON.stringify(sorted, null, 2) + '\n';
  const temp = path + `.tmp.${process.pid}`;

  try {
    await writeFile(temp, content, 'utf8');
    await rename(temp, path);
  } catch (error) {
    // Clean up temp file if it still exists.
    try {
      await unlink(temp);
    } catch {
      // Ignore cleanup errors.
    }
    throw error;
  }
}

/** Compute a content hash of a lockfile for change detection. */
export function computeLockfileHash(lockfile: Lockfile): string {
  const sorted = sortLockfile(lockfile);
  const content = JSON.stringify(sorted, null, 2);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Sort collections and skills alphabetically for deterministic output. */
function sortLockfile(lockfile: Lockfile): Lockfile {
  const sortedCollections: Record<string, CollectionLockEntry> = {};
  const collectionNames = Object.keys(lockfile.collections).sort();
  for (const name of collectionNames) {
    const entry = lockfile.collections[name];
    sortedCollections[name] = {
      source: entry.source,
      ref: entry.ref,
      commit: entry.commit,
      manifestHash: entry.manifestHash,
      ...(entry.only && { only: [...entry.only].sort() }),
      skills: [...entry.skills].sort(),
      preexisting: [...entry.preexisting].sort(),
      scope: entry.scope,
    };
  }
  return { version: lockfile.version, collections: sortedCollections };
}
