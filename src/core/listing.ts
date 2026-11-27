import { homedir } from 'os';
import { styleText } from 'util';
import type { CollectionLockEntry, Lockfile } from './lockfile.js';
import type { InstallScope } from './scope.js';

/** One row of the listing: a skill, and the collection that brought it. */
export interface ListedEntry {
  readonly skill: string;
  /** Collection name, as recorded in kitcrate-lock.json. */
  readonly collection: string;
  /** Source of the collection that owns the skill. */
  readonly collectionSource: string;
  /** Installed directory. Absent when the skill is not installed. */
  readonly path?: string;
  /** Agent display names, e.g. `Claude Code`. */
  readonly agents: readonly string[];
  /** Agent ids, e.g. `claude-code`, in the same order as `agents`. */
  readonly agentIds: readonly string[];
  /** Source the skill itself came from. Absent when no skills lockfile records one. */
  readonly source?: string;
  /** The skill was already installed before the collection was added. */
  readonly preexisting: boolean;
  /** Scope the collection was installed at. A member is matched only in this scope. */
  readonly scope: InstallScope;
}

/** The installed copy of a skill, as the `skills` adapter reports it. */
export interface InstalledSkill {
  readonly name: string;
  readonly scope: InstallScope;
  readonly path?: string;
  readonly agents: readonly string[];
  readonly agentNames: readonly string[];
  readonly source?: string;
}

/** Agent display names shown before the count rather than listed in full. */
const MAX_AGENTS_SHOWN = 5;

/** Agents line body with at most `MAX_AGENTS_SHOWN` names, then `+N more`. */
export function formatAgents(names: readonly string[]): string {
  const shown = names.slice(0, MAX_AGENTS_SHOWN).join(', ');
  const rest = names.length - MAX_AGENTS_SHOWN;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

/**
 * Replace a leading home directory with `~`. `home` defaults to `os.homedir()`,
 * which already honours `$HOME`, so the abbreviation follows the running user.
 */
export function abbreviateHome(path: string, home: string = homedir()): string {
  if (path === home) return '~';
  if (home === '') return path;
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Where a skill's own source is unknown, say so instead of printing nothing. */
const UNKNOWN_SOURCE = 'not recorded in skills-lock.json';

/**
 * Pair every collection's member skills with the installed copy of that skill,
 * in collection order then skill order. A locked skill that is not installed
 * still gets a row, so nothing in the lockfile goes missing.
 *
 * The match is by name and scope. The adapter lists both scopes, so a global
 * skill sharing a name with a project member would otherwise lend its path and
 * source to a copy the collection never installed.
 */
export function buildListedEntries(
  collections: readonly (readonly [string, CollectionLockEntry])[],
  installed: readonly InstalledSkill[]
): readonly ListedEntry[] {
  return collections.flatMap(([collection, entry]) =>
    entry.skills.map((skill): ListedEntry => {
      const found = installed.find((s) => s.name === skill && s.scope === entry.scope);
      return {
        skill,
        collection,
        collectionSource: entry.source,
        ...(found?.path !== undefined && { path: found.path }),
        agents: found?.agentNames ?? [],
        agentIds: found?.agents ?? [],
        ...(found?.source !== undefined && { source: found.source }),
        preexisting: entry.preexisting.includes(skill),
        scope: entry.scope,
      };
    })
  );
}

/** Line 1 of an entry: the skill, its preexisting mark, and where it lives. */
function heading(entry: ListedEntry): { name: string; note: string; path: string } {
  return {
    name: entry.skill,
    note: entry.preexisting ? 'preexisting' : '',
    path: entry.path === undefined ? 'not installed' : abbreviateHome(entry.path),
  };
}

/** Render one entry as the human-readable block, without colour. */
export function formatEntry(entry: ListedEntry): string {
  const { name, note, path } = heading(entry);
  return [
    `${name}${note ? ` (${note})` : ''} ${path}`,
    '',
    `Agents: ${entry.agents.length > 0 ? formatAgents(entry.agents) : 'none'}`,
    '',
    `Collection: ${entry.collectionSource}`,
    '',
    `Source: ${entry.source ?? UNKNOWN_SOURCE}`,
  ].join('\n');
}

/**
 * Render one entry for a terminal. `styleText` returns its input untouched when
 * stdout is not a TTY, so a piped run stays plain without a second code path.
 */
export function styleEntry(entry: ListedEntry): string {
  const { name, note, path } = heading(entry);
  const dim = (text: string): string => styleText('dim', text);
  const preexisting = note ? ` ${dim(`(${note})`)}` : '';
  const agents = entry.agents.length > 0 ? formatAgents(entry.agents) : dim('none');
  return [
    `${styleText('bold', name)}${preexisting} ${dim(path)}`,
    '',
    `${dim('Agents:')} ${agents}`,
    '',
    `${dim('Collection:')} ${styleText('cyan', entry.collectionSource)}`,
    '',
    `${dim('Source:')} ${entry.source === undefined ? dim(UNKNOWN_SOURCE) : styleText('green', entry.source)}`,
  ].join('\n');
}

/** The whole human-readable listing, one block per entry, separated by a blank line. */
export function formatList(entries: readonly ListedEntry[], style: boolean = true): string {
  if (entries.length === 0) return 'No collections installed.';
  return entries.map(style ? styleEntry : formatEntry).join('\n\n');
}

/** One skill in the machine-readable view. */
export interface ListedEntryJson {
  readonly name: string;
  readonly path: string | null;
  readonly agents: readonly { readonly id: string; readonly name: string }[];
  readonly collection: string;
  readonly source: string | null;
  readonly preexisting: boolean;
  readonly scope: InstallScope;
}

/**
 * The machine-readable view. Provenance the human output drops (ref, commit,
 * manifest hash, only) stays here, because a script diffing an update needs it.
 * Skills list once, under `skills`, not again per collection.
 */
export function toJsonList(
  collections: readonly (readonly [string, CollectionLockEntry])[],
  entries: readonly ListedEntry[]
): {
  collections: readonly Record<string, unknown>[];
  skills: readonly ListedEntryJson[];
} {
  return {
    collections: collections.map(([name, entry]) => ({
      name,
      source: entry.source,
      scope: entry.scope,
      ref: entry.ref,
      commit: entry.commit,
      manifestHash: entry.manifestHash,
      ...(entry.only && { only: entry.only }),
    })),
    skills: entries.map((entry) => ({
      name: entry.skill,
      path: entry.path ?? null,
      agents: entry.agentIds.map((id, index) => ({ id, name: entry.agents[index] ?? id })),
      collection: entry.collection,
      source: entry.source ?? null,
      preexisting: entry.preexisting,
      scope: entry.scope,
    })),
  };
}

/** Sorted `[name, entry]` pairs, the order both views render in. */
export function sortedCollections(
  lockfile: Lockfile
): readonly (readonly [string, CollectionLockEntry])[] {
  return Object.entries(lockfile.collections).sort(([a], [b]) => a.localeCompare(b));
}
