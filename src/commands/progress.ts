import { spinner } from '@clack/prompts';

/** How long the work has to take before a spinner is worth drawing. */
const PROGRESS_DELAY_MS = 300;

/**
 * Run `work` under a spinner, except where the spinner would pollute the output:
 * `--json` (it would corrupt the JSON) or a redirected stdout (it is not a
 * terminal to draw on).
 *
 * The spinner only appears once the work has outlasted `PROGRESS_DELAY_MS`, so
 * a fast call does not flash one, and it is erased when the work lands, so the
 * result is the only thing left on the screen.
 *
 * Reading the global scope through the `skills` API is the slow case this
 * exists for: it scans every agent's directory on the machine.
 */
export async function withProgress<T>(
  json: boolean,
  message: string,
  work: () => Promise<T>
): Promise<T> {
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
