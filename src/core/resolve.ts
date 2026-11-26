import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseCollectionManifest, type CollectionManifest } from './manifest.js';
import { computeManifestHash } from './hash.js';
import { cloneRepo, git } from '../git/index.js';

/** Result of resolving a collection source. */
export interface ResolvedManifest {
  /** Parsed and validated collection manifest. */
  readonly manifest: CollectionManifest;
  /** Pinned commit SHA of the resolved collection.json. */
  readonly commit: string;
  /** SHA-256 hash of the collection.json content. */
  readonly manifestHash: string;
  /** Original source string. */
  readonly source: string;
  /** Resolved ref, if any. */
  readonly ref?: string;
  /** Normalized git URL. */
  readonly url: string;
}

/** Parse a collection source string into a normalized URL and optional ref. */
function parseSource(source: string): { url: string; ref?: string } {
  const trimmed = source.trim();

  // Already a full URL
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('git://')
  ) {
    let url = trimmed;
    let ref: string | undefined;
    // Handle url@ref
    const atIndex = url.lastIndexOf('@');
    if (atIndex > 0 && url[atIndex - 1] !== ':') {
      ref = url.slice(atIndex + 1);
      url = url.slice(0, atIndex);
    }
    return { url, ref };
  }

  // Local path
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return { url: trimmed };
  }

  // github:owner/repo[@ref] or owner/repo[@ref]
  const stripped = trimmed.replace(/^github:/, '');
  const atIndex = stripped.lastIndexOf('@');
  let repo = stripped;
  let ref: string | undefined;
  if (atIndex > 0) {
    ref = stripped.slice(atIndex + 1);
    repo = stripped.slice(0, atIndex);
  }

  if (repo.includes('/')) {
    return { url: `https://github.com/${repo}.git`, ref };
  }

  throw new Error(
    `Invalid collection source: "${source}". Expected owner/repo[@ref], github:owner/repo[@ref], a git URL, or a local path.`
  );
}

/** Resolve a collection source: fetch collection.json, pin the commit, compute the manifest hash. */
export async function resolveCollection(source: string): Promise<ResolvedManifest> {
  const { url, ref } = parseSource(source);

  // Local path: read collection.json directly, no git commit available.
  if (!url.startsWith('http') && !url.startsWith('git')) {
    const manifestJson = await readFile(url, 'utf8');
    const manifest = parseCollectionManifest(JSON.parse(manifestJson));
    const manifestHash = computeManifestHash(manifestJson);
    return { manifest, commit: '', manifestHash, source, url };
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'kitcrate-resolve-'));
  try {
    // Clone shallow at the ref if given, otherwise default branch.
    await cloneRepo(url, tempDir, ref);

    // Get the exact commit SHA we cloned.
    const revResult = await git(['rev-parse', 'HEAD'], tempDir);
    if (revResult.code !== 0) {
      throw new Error(`Failed to resolve commit SHA: ${revResult.stderr.trim()}`);
    }
    const commit = revResult.stdout.trim();
    if (!commit) {
      throw new Error(`Empty commit SHA from git rev-parse HEAD`);
    }

    // Read collection.json from the working tree.
    const manifestJson = await readFile(join(tempDir, 'collection.json'), 'utf8');
    const manifest = parseCollectionManifest(JSON.parse(manifestJson));
    const manifestHash = computeManifestHash(manifestJson);

    return { manifest, commit, manifestHash, source, ref, url };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
