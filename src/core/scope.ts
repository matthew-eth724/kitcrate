import { homedir } from 'os';
import { join } from 'path';

/** Where a collection's skills are installed. */
export type InstallScope = 'project' | 'global';

/** The default scope: install into the current project. */
export const DEFAULT_SCOPE: InstallScope = 'project';

/**
 * The directory a scope's skills live in, for display in prompts and output.
 * This mirrors the `skills` CLI's canonical directory and is display-only: the
 * install always goes through the `skills` API, so if upstream ever changes the
 * path only the hint text goes stale.
 */
export function scopeDirectory(scope: InstallScope, cwd: string): string {
  return scope === 'global' ? join(homedir(), '.agents', 'skills') : join(cwd, '.agents', 'skills');
}
