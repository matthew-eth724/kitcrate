import { z } from 'zod';

/** A single skill reference in a collection manifest. */
export const CollectionSkillSchema = z.object({
  /** Source identifier (owner/repo, git URL, or local path). */
  source: z
    .string()
    .min(1, 'source must not be empty')
    .refine(
      (s) => !s.includes('..') && !s.includes('://') && !s.startsWith('/') && !s.startsWith('\\'),
      'source must not contain path traversal segments, absolute paths, or URLs'
    ),
  /** Skill name within the source. */
  skill: z
    .string()
    .min(1, 'skill must not be empty')
    .refine(
      (s) => !s.includes('..') && !s.includes('/') && !s.startsWith('\\'),
      'skill must be a simple name without path segments'
    ),
  /** Optional ref (branch/tag/commit) for this specific skill. */
  ref: z.string().min(1, 'ref must not be empty if provided').optional(),
});

export type CollectionSkill = z.infer<typeof CollectionSkillSchema>;

/** Collection manifest (collection.json) schema. */
export const CollectionManifestSchema = z.object({
  name: z
    .string()
    .min(1, 'name must not be empty')
    .refine(
      (s) => /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(s),
      'name must be lowercase, alphanumeric, with hyphens between segments'
    ),
  version: z
    .string()
    .min(1, 'version must not be empty')
    .refine(
      (s) => /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(s),
      'version must be a valid semver string (e.g. 1.2.0)'
    ),
  description: z.string().min(1, 'description must not be empty'),
  skills: z.array(CollectionSkillSchema).min(1, 'collection must list at least one skill'),
});

export type CollectionManifest = z.infer<typeof CollectionManifestSchema>;

/** Parse and validate a collection.json document. Throws on invalid input. */
export function parseCollectionManifest(input: unknown): CollectionManifest {
  return CollectionManifestSchema.parse(input);
}

/** Safely parse a collection.json document. Returns { success, data } or { success, error }. */
export function safeParseCollectionManifest(input: unknown) {
  return CollectionManifestSchema.safeParse(input);
}
