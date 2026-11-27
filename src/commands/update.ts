import {
  readLockfile,
  writeLockfile,
  type CollectionLockEntry,
  type Lockfile,
} from '../core/lockfile.js';
import { resolveCollection, type ResolvedManifest } from '../core/resolve.js';
import { installCollectionSkills, removeCollectionSkills } from '../skills/index.js';
import type { CommandOptions } from '../core/options.js';

/** Handle the `kitcrate update [name]` command. */
export async function updateCommand(argv: string[], options: CommandOptions): Promise<number> {
  const { json, yes } = options;
  const cwd = process.cwd();
  const collectionName = argv[0];

  try {
    const lockfile = await readLockfile(cwd);
    const collectionNames = Object.keys(lockfile.collections).sort();

    if (collectionNames.length === 0) {
      if (json) {
        console.log(JSON.stringify({ updated: 0, collections: [] }, null, 2));
      } else {
        console.log('No collections installed. Run `kitcrate add <source>` to install one.');
      }
      return 0;
    }

    const targets = collectionName ? [collectionName] : collectionNames;

    // Validate that all targets exist.
    for (const name of targets) {
      if (!lockfile.collections[name]) {
        console.error(
          `Collection "${name}" is not installed. Run \`kitcrate list\` to see installed collections.`
        );
        return 1;
      }
    }

    const updated: Array<{
      name: string;
      source: string;
      oldCommit: string;
      newCommit: string;
      manifestHashChanged: boolean;
      skillsAdded: string[];
      skillsRemoved: string[];
    }> = [];

    for (const name of targets) {
      const entry = lockfile.collections[name];

      // Re-resolve the collection at its locked ref.
      let resolved: ResolvedManifest;
      try {
        resolved = await resolveCollection(entry.source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to re-resolve collection "${name}" (${entry.source}): ${message}`);
        return 1;
      }

      const oldSkills = new Set(entry.skills);
      const newSkills = new Set(resolved.manifest.skills.map((s) => s.skill));
      const skillsAdded = resolved.manifest.skills
        .map((s) => s.skill)
        .filter((s) => !oldSkills.has(s));
      const skillsRemoved = entry.skills.filter((s) => !newSkills.has(s));
      const manifestHashChanged = resolved.manifestHash !== entry.manifestHash;

      // Confirm destructive changes unless --yes.
      if (!yes && (skillsRemoved.length > 0 || manifestHashChanged)) {
        const details: string[] = [];
        if (skillsRemoved.length > 0) {
          details.push(`skills removed: ${skillsRemoved.join(', ')}`);
        }
        if (manifestHashChanged) {
          details.push('manifestHash changed');
        }
        console.error(
          `Update for collection "${name}" would: ${details.join('; ')}. ` + 'Use --yes to proceed.'
        );
        return 1;
      }

      // Remove skills no longer in the manifest (respecting ownership rules).
      for (const skill of skillsRemoved) {
        // Check if skill is preexisting or claimed by another collection.
        if (entry.preexisting.includes(skill)) {
          if (!json) {
            console.log(
              `  Skipping removal of "${skill}" (preexisting skill, not owned by this collection).`
            );
          }
          continue;
        }
        const claimedByOther = collectionNames
          .filter((other) => other !== name)
          .some((other) => lockfile.collections[other].skills.includes(skill));
        if (claimedByOther) {
          if (!json) {
            console.log(`  Skipping removal of "${skill}" (claimed by another collection).`);
          }
          continue;
        }
        const removeResult = await removeCollectionSkills([skill], {
          cwd,
          scope: entry.scope,
        });
        if (removeResult.failed.length > 0) {
          console.error(`Failed to remove skill "${skill}": ${removeResult.failed[0].message}`);
          return 1;
        }
      }

      // Install newly added skills.
      if (skillsAdded.length > 0) {
        const result = await installCollectionSkills(entry.source, {
          skills: skillsAdded,
          scope: entry.scope,
          mode: 'auto',
        });
        if (result.failed.length > 0) {
          for (const failure of result.failed) {
            console.error(`Failed to install skill "${failure.name}": ${failure.message}`);
          }
          return 1;
        }
      }

      // Rewrite the lockfile entry.
      const updatedEntry: CollectionLockEntry = {
        source: resolved.source,
        ref: resolved.ref ?? entry.ref,
        commit: resolved.commit,
        manifestHash: resolved.manifestHash,
        skills: [...newSkills],
        preexisting: entry.preexisting,
        scope: entry.scope,
        ...(resolved.manifest.skills.length > 0 && { only: [...newSkills] }),
      };

      const updatedLockfile: Lockfile = {
        version: 1,
        collections: {
          ...lockfile.collections,
          [name]: updatedEntry,
        },
      };

      await writeLockfile(cwd, updatedLockfile);

      updated.push({
        name,
        source: resolved.source,
        oldCommit: entry.commit,
        newCommit: resolved.commit,
        manifestHashChanged,
        skillsAdded,
        skillsRemoved,
      });
    }

    if (json) {
      console.log(JSON.stringify({ updated: updated.length, collections: updated }, null, 2));
    } else {
      console.log(`Updated ${updated.length} collection(s):`);
      for (const u of updated) {
        console.log(`  ${u.name}: ${u.oldCommit.slice(0, 7)} -> ${u.newCommit.slice(0, 7)}`);
        if (u.skillsAdded.length > 0) {
          console.log(`    skills added: ${u.skillsAdded.join(', ')}`);
        }
        if (u.skillsRemoved.length > 0) {
          console.log(`    skills removed: ${u.skillsRemoved.join(', ')}`);
        }
        if (!u.manifestHashChanged && u.skillsAdded.length === 0 && u.skillsRemoved.length === 0) {
          console.log('    no changes');
        }
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to update: ${message}`);
    return 1;
  }
}
