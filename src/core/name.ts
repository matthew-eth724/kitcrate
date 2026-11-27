/** Result of normalizing a human-entered collection name. */
export type NormalizedName =
  | { readonly ok: true; readonly name: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

/** The convention every published collection name must follow. */
const COLLECTION_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** Characters the convention allows. Any other character means the name is unsupported. */
const ALLOWED_CHARACTERS = /^[a-z0-9-]+$/;

/** Quote the characters that cannot be expressed in the name convention. */
function describeUnsupported(characters: readonly string[]): string {
  return characters.map((c) => JSON.stringify(c)).join(', ');
}

/** Characters (after lowercasing) that break the convention, deduplicated and sorted. */
function findUnsupportedCharacters(value: string): string[] {
  const unsupported = new Set<string>();
  for (const character of value) {
    if (!ALLOWED_CHARACTERS.test(character)) unsupported.add(character);
  }
  return [...unsupported].sort();
}

/**
 * Parse a human-entered collection name into the published convention:
 * lowercase, hyphens between segments. Unsupported characters are refused
 * rather than guessed at, so the author can fix them.
 *
 * The manifest schema still rejects invalid names; this only runs at the prompt
 * boundary, before anything reaches `collection.json`.
 */
export function normalizeCollectionName(input: string): NormalizedName {
  const trimmed = input.trim();
  const name = trimmed
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (name.length === 0) {
    return { ok: false, reason: 'Collection name must not be empty.' };
  }

  if (!COLLECTION_NAME_PATTERN.test(name)) {
    const unsupported = findUnsupportedCharacters(name);
    return {
      ok: false,
      reason:
        `Collection names may only contain lowercase letters, digits, and hyphens. ` +
        `Unsupported: ${describeUnsupported(unsupported)}. Spaces are converted to hyphens.`,
    };
  }

  return { ok: true, name, changed: name !== trimmed };
}
