import { spinner } from '@clack/prompts';
import { readLockfile } from '../core/lockfile.js';
import {
  buildListedEntries,
  formatList,
  sortedCollections,
  toJsonList,
  type InstalledSkill,
} from '../core/listing.js';
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
      listInstalledSkills({ cwd })
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

/** How long the work has to take before a spinner is worth drawing. */
const PROGRESS_DELAY_MS = 300;

/**
 * Run `work` under a spinner, except where the spinner would pollute the output:
 * `--json` (it would corrupt the JSON) or a redirected stdout (it is not a
 * terminal to draw on).
 *
 * The spinner only appears once the work has outlasted `PROGRESS_DELAY_MS`, so
 * a fast listing does not flash one, and it is erased when the work lands, so
 * the listing is the only thing left on the screen.
 */
async function withProgress<T>(json: boolean, message: string, work: () => Promise<T>): Promise<T> {
  if (json || !process.stdout.isTTY) return work();
  const progress = spinner();
  let shown = false;
  const show = setTimeout(() => {
    shown = true;
    progress.start(message);
  }, PROGRESS_DELAY_MS);
  try {
    return await work();
  } finally {
    clearTimeout(show);
    if (shown) progress.clear();
  }
}
