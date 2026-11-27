import { readLockfile } from '../core/lockfile.js';
import { resolveCollection, type ResolvedManifest } from '../core/resolve.js';
import { installCollectionSkills, listInstalledSkills } from '../skills/index.js';
import type { CommandOptions } from '../core/options.js';

/** Handle the `kitcrate install` command. */
export async function installCommand(_argv: string[], options: CommandOptions): Promise<number> {
  const { json } = options;
  const cwd = process.cwd();

  try {
    const lockfile = await readLockfile(cwd);
    const collectionNames = Object.keys(lockfile.collections).sort();

    if (collectionNames.length === 0) {
      if (json) {
        console.log(JSON.stringify({ restored: 0, collections: [] }, null, 2));
      } else {
        console.log('No collections installed. Run `kitcrate add <source>` to install one.');
      }
      return 0;
    }

    const restored: Array<{
      name: string;
      source: string;
      commit: string;
      manifestHash: string;
      skillsRestored: number;
    }> = [];

    for (const name of collectionNames) {
      const entry = lockfile.collections[name];

      // Re-resolve the collection to verify manifestHash.
      let resolved: ResolvedManifest;
      try {
        resolved = await resolveCollection(entry.source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to re-resolve collection "${name}" (${entry.source}): ${message}`);
        return 1;
      }

      // Verify manifestHash matches.
      if (resolved.manifestHash !== entry.manifestHash) {
        console.error(
          `manifestHash mismatch for collection "${name}": locked ${entry.manifestHash}, current ${resolved.manifestHash}. ` +
            'The collection.json has changed since install. Run `kitcrate update ' +
            name +
            '` to refresh.'
        );
        return 1;
      }

      // Install any member skills not already installed in the collection's scope.
      const installedSkills = await listInstalledSkills({ cwd });
      const installedNames = new Set(
        installedSkills.filter((s) => s.scope === entry.scope).map((s) => s.name)
      );
      const skillsToInstall = entry.skills.filter((s) => !installedNames.has(s));

      let skillsRestored = 0;
      if (skillsToInstall.length > 0) {
        const result = await installCollectionSkills(entry.source, {
          skills: skillsToInstall,
          scope: entry.scope,
          mode: 'auto',
        });
        // The `skills` API reports one entry per agent, so count distinct names.
        skillsRestored = new Set(result.installed.map((member) => member.name)).size;
        if (result.failed.length > 0) {
          for (const failure of result.failed) {
            console.error(`Failed to install skill "${failure.name}": ${failure.message}`);
          }
          return 1;
        }
      }

      restored.push({
        name,
        source: resolved.source,
        commit: resolved.commit,
        manifestHash: resolved.manifestHash,
        skillsRestored,
      });
    }

    if (json) {
      console.log(JSON.stringify({ restored: restored.length, collections: restored }, null, 2));
    } else {
      console.log(`Restored ${restored.length} collection(s):`);
      for (const r of restored) {
        console.log(
          `  ${r.name} (${r.source}) at ${r.commit.slice(0, 7)} - ${r.skillsRestored} skill(s) restored`
        );
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to install: ${message}`);
    return 1;
  }
}
