import { readLockfile, writeLockfile, type Lockfile } from '../core/lockfile.js';
import { removeCollectionSkills } from '../skills/index.js';
import type { CommandOptions } from '../core/options.js';

/** Handle the `kitcrate remove <name>` command. */
export async function removeCommand(argv: string[], options: CommandOptions): Promise<number> {
  const { json, yes } = options;
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printRemoveHelp();
    return argv.length === 0 ? 1 : 0;
  }

  const collectionName = argv[0];
  const cwd = process.cwd();

  try {
    const lockfile = await readLockfile(cwd);

    if (!lockfile.collections[collectionName]) {
      console.error(
        `Collection "${collectionName}" is not installed. Run \`kitcrate list\` to see installed collections.`
      );
      return 1;
    }

    const entry = lockfile.collections[collectionName];
    const collectionNames = Object.keys(lockfile.collections).sort();

    // Determine which skills to remove: in collection's skills, not preexisting, not claimed by another collection.
    const skillsToRemove: string[] = [];
    const skipped: Array<{ skill: string; reason: string }> = [];

    for (const skill of entry.skills) {
      if (entry.preexisting.includes(skill)) {
        skipped.push({ skill, reason: 'preexisting (installed before this collection)' });
        continue;
      }
      const claimedByOther = collectionNames
        .filter((other) => other !== collectionName)
        .some((other) => lockfile.collections[other].skills.includes(skill));
      if (claimedByOther) {
        skipped.push({ skill, reason: 'claimed by another collection' });
        continue;
      }
      skillsToRemove.push(skill);
    }

    // Confirm unless --yes.
    if (!yes && (skillsToRemove.length > 0 || skipped.length > 0)) {
      const details: string[] = [];
      if (skillsToRemove.length > 0) {
        details.push(`remove: ${skillsToRemove.join(', ')}`);
      }
      if (skipped.length > 0) {
        details.push(`keep: ${skipped.map((s) => `${s.skill} (${s.reason})`).join(', ')}`);
      }
      console.error(
        `Removing collection "${collectionName}" would: ${details.join('; ')}. Use --yes to proceed.`
      );
      return 1;
    }

    // Remove owned skills via skills API.
    const removed: string[] = [];
    const leftInPlace: Array<{ skill: string; reason: string }> = [];

    if (skillsToRemove.length > 0) {
      const result = await removeCollectionSkills(skillsToRemove, {
        cwd,
        scope: entry.scope,
      });
      removed.push(...result.removed);
      for (const failure of result.failed) {
        leftInPlace.push({ skill: failure.name, reason: failure.message });
      }
    }

    // Remove the collection entry from the lockfile.
    const updated: Lockfile = {
      version: 1,
      collections: {
        ...lockfile.collections,
      },
    };
    delete updated.collections[collectionName];

    await writeLockfile(cwd, updated);

    if (json) {
      console.log(
        JSON.stringify(
          {
            collection: collectionName,
            removed,
            skipped: skipped.map((s) => ({ skill: s.skill, reason: s.reason })),
            leftInPlace,
          },
          null,
          2
        )
      );
    } else {
      console.log(`Removed collection "${collectionName}" from kitcrate-lock.json.`);
      if (removed.length > 0) {
        console.log(`  Removed ${removed.length} skill(s): ${removed.join(', ')}`);
      }
      if (skipped.length > 0) {
        console.log(`  Kept ${skipped.length} skill(s) (not owned by this collection):`);
        for (const s of skipped) {
          console.log(`    - ${s.skill}: ${s.reason}`);
        }
      }
      if (leftInPlace.length > 0) {
        console.log(
          `  Left ${leftInPlace.length} skill(s) in place (no longer matches kitcrate install):`
        );
        for (const s of leftInPlace) {
          console.log(`    - ${s.skill}: ${s.reason}`);
        }
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to remove collection "${collectionName}": ${message}`);
    return 1;
  }
}

function printRemoveHelp(): void {
  console.error(`Usage: kitcrate remove <name>

Remove a collection from kitcrate-lock.json and delete only the skills
kitcrate installed itself (see ownership rules in AGENTS.md).

A skill is deleted only if:
  - it is in the collection's skills list, AND
  - it is not in the collection's preexisting list, AND
  - it is not claimed by another installed collection.

Before deleting, kitcrate compares the skill's skills-lock.json entry
with what kitcrate installed. If it no longer matches, the skill is
left in place and reported.

Arguments:
  <name>   Name of the collection to remove.

Options:
  --yes     Non-interactive use (skip confirmation prompts)
  --json    Machine-readable output
  --debug   Include stack traces on errors

Example:
  kitcrate remove web-security
  kitcrate remove web-security --yes`);
}
