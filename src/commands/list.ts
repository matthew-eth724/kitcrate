import { readLockfile } from '../core/lockfile.js';
import { listInstalledSkills } from '../skills/index.js';
import type { CommandOptions } from '../core/options.js';

/** Handle the `kitcrate list` command. */
export async function listCommand(_argv: string[], options: CommandOptions): Promise<number> {
  const { json } = options;
  const cwd = process.cwd();

  try {
    const lockfile = await readLockfile(cwd);
    const collectionNames = Object.keys(lockfile.collections).sort();

    if (collectionNames.length === 0) {
      if (json) {
        console.log(JSON.stringify({ collections: [] }, null, 2));
      } else {
        console.log('No collections installed.');
      }
      return 0;
    }

    const installedSkills = await listInstalledSkills({ cwd });

    const results = collectionNames.map((name) => {
      const entry = lockfile.collections[name];
      const memberSkills = installedSkills.filter((s) => entry.skills.includes(s.name));
      return {
        name,
        source: entry.source,
        scope: entry.scope,
        ref: entry.ref,
        commit: entry.commit,
        manifestHash: entry.manifestHash,
        only: entry.only,
        skills: entry.skills,
        preexisting: entry.preexisting,
        installedSkills: memberSkills.map((s) => ({
          name: s.name,
          source: s.source,
          agents: s.agents,
        })),
      };
    });

    if (json) {
      console.log(JSON.stringify({ collections: results }, null, 2));
    } else {
      for (const c of results) {
        console.log(`Collection: ${c.name}`);
        console.log(`  source: ${c.source}`);
        console.log(`  scope: ${c.scope}`);
        console.log(`  ref: ${c.ref}`);
        console.log(`  commit: ${c.commit.slice(0, 7)}`);
        console.log(`  manifestHash: ${c.manifestHash}`);
        if (c.only) {
          console.log(`  only: ${c.only.join(', ')}`);
        }
        console.log(`  skills (${c.skills.length}):`);
        for (const skill of c.skills) {
          const marker = c.preexisting.includes(skill) ? ' (preexisting)' : '';
          console.log(`    - ${skill}${marker}`);
        }
        if (c.installedSkills.length > 0) {
          console.log(`  installed in agents:`);
          for (const s of c.installedSkills) {
            console.log(
              `    - ${s.name} -> ${s.agents.join(', ')} (source: ${s.source ?? 'unknown'})`
            );
          }
        }
        console.log('');
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to list collections: ${message}`);
    return 1;
  }
}
