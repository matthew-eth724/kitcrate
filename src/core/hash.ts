import { createHash } from 'crypto';

/** Prefix for manifest hash values. */
export const MANIFEST_HASH_PREFIX = 'sha256';

/** Compute a SHA-256 manifest hash over the raw bytes of a collection.json document. */
export function computeManifestHash(manifestBytes: string | Buffer): string {
  const buffer =
    typeof manifestBytes === 'string' ? Buffer.from(manifestBytes, 'utf8') : manifestBytes;
  const digest = createHash('sha256').update(buffer).digest('hex');
  return `${MANIFEST_HASH_PREFIX}-${digest}`;
}
