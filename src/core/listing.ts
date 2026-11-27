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

/** The colour formats the listing uses. */
type PaintFormat = 'bold' | 'dim' | 'cyan' | 'green';

/** Paints a fragment of text, or leaves it alone. */
type Painter = (text: string, format: PaintFormat) => string;

/** Leaves every fragment as it is. */
const plain: Painter = (text) => text;

/** Colours a fragment for a terminal. */
const painted: Painter = (text, format) => styleText(format, text);

/** Where the skill lives, and whether it was already there before the collection. */
function heading(entry: ListedEntry): { name: string; note?: string; path: string } {
  return {
    name: entry.skill,
    ...(entry.preexisting && { note: 'preexisting' }),
    path: entry.path === undefined ? '(not installed)' : abbreviateHome(entry.path),
  };
}

/**
 * Render one entry as the human-readable block. The layout lives here so the
 * plain and the coloured rendering cannot drift apart.
 */
function renderEntry(entry: ListedEntry, paint: Painter): string {
  const { name, note, path } = heading(entry);
  const preexisting = note ? ` ${paint(`(${note})`, 'dim')}` : '';
  const agents = entry.agents.length > 0 ? formatAgents(entry.agents) : paint('none', 'dim');
  const source =
    entry.source === undefined ? paint(UNKNOWN_SOURCE, 'dim') : paint(entry.source, 'green');
  return [
    `${paint(name, 'bold')}${preexisting} ${paint(path, 'dim')}`,
    '',
    `${paint('Agents:', 'dim')} ${agents}`,
    '',
    `${paint('Collection:', 'dim')} ${paint(entry.collectionSource, 'cyan')}`,
    '',
    `${paint('Source:', 'dim')} ${source}`,
  ].join('\n');
}

/** Render one entry without colour. */
export function formatEntry(entry: ListedEntry): string {
  return renderEntry(entry, plain);
}

/**
 * Render one entry for a terminal. `styleText` returns its input untouched when
 * stdout is not a TTY, so a piped run stays plain without a second code path.
 */
export function styleEntry(entry: ListedEntry): string {
  return renderEntry(entry, painted);
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

/** One collection's provenance in the machine-readable view. */
export interface ListedCollectionJson {
  readonly name: string;
  readonly source: string;
  readonly scope: InstallScope;
  readonly ref: string;
  readonly commit: string;
  readonly manifestHash: string;
  readonly only?: readonly string[];
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
  collections: readonly ListedCollectionJson[];
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

/**
 * The scopes the listing has to read. A collection's members are matched in the
 * scope the collection was installed at, so a scope no collection uses holds
 * nothing this listing can show. Reading the global scope is the expensive
 * half: it holds a copy of every skill for every agent on the machine.
 */
export function scopesToRead(
  collections: readonly (readonly [string, CollectionLockEntry])[]
): 'project' | 'global' | 'all' {
  const scopes = new Set(collections.map(([, entry]) => entry.scope));
  if (scopes.size === 1) return scopes.has('global') ? 'global' : 'project';
  return 'all';
}
