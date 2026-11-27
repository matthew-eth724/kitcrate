import { readLockfile } from '../core/lockfile.js';
import {
  buildListedEntries,
  formatList,
  scopesToRead,
  sortedCollections,
  toJsonList,
  type InstalledSkill,
} from '../core/listing.js';
import { withProgress } from './progress.js';
import { listInstalledSkills } from '../skills/index.js';
import type { CommandOptions } from '../core/options.js';

/** Usage text for `kitcrate list`. */
export const LIST_USAGE = `Usage: kitcrate list

Show every installed skill with its path, the agents it is installed for,
the collection that brought it, and the source the skill itself came from.

Options:
  --json    Machine-readable output
  --debug   Include stack traces on errors`;

/** Handle the `kitcrate list` command. */
export async function listCommand(_argv: string[], options: CommandOptions): Promise<number> {
  const { json } = options;
  const cwd = process.cwd();

  try {
    const collections = sortedCollections(await readLockfile(cwd));

    if (collections.length === 0) {
      console.log(json ? JSON.stringify(toJsonList([], []), null, 2) : formatList([]));
      return 0;
    }

    const installed = await withProgress(json, 'Reading installed skills', () =>
      listInstalledSkills({ cwd, scope: scopesToRead(collections) })
    );
    const entries = buildListedEntries(collections, installed satisfies readonly InstalledSkill[]);

    console.log(
      json ? JSON.stringify(toJsonList(collections, entries), null, 2) : formatList(entries)
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to list collections: ${message}`);
    return 1;
  }
}
