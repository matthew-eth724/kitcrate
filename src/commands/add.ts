import {
  readLockfile,
  writeLockfile,
  type CollectionLockEntry,
  type Lockfile,
} from '../core/lockfile.js';
import { resolveCollection } from '../core/resolve.js';
import {
  installCollectionSkills,
  listInstalledSkills,
  type InstalledMember,
} from '../skills/index.js';
import type { CommandOptions } from '../core/options.js';

/** Handle the `kitcrate add <source>` command. */
export async function addCommand(argv: string[], options: CommandOptions): Promise<number> {
  const { yes, json } = options;
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printAddHelp();
    return argv.length === 0 ? 1 : 0;
  }

  const source = argv[0];

  try {
    // 1. Resolve the collection source (fetch collection.json, pin commit, compute hash).
    const resolved = await resolveCollection(source);
    const manifest = resolved.manifest;

    // 2. Read existing lockfile (or start empty).
    const cwd = process.cwd();
    const lockfile = await readLockfile(cwd);

    // 3. Check for conflicts: collection already installed under same name.
    if (lockfile.collections[manifest.name]) {
      const existing = lockfile.collections[manifest.name];
      const message = `Collection "${manifest.name}" is already installed (source: ${existing.source}, ref: ${existing.ref}). `;
      if (yes) {
        console.error(
          `${message}Use --yes to override is not supported for add; use kitcrate update instead.`
        );
      } else {
        console.error(`${message}Use \`kitcrate update ${manifest.name}\` to update it instead.`);
      }
      return 1;
    }

    // 4. Determine preexisting skills (already installed via skills-lock.json).
    const installedSkills = await listInstalledSkills({ cwd });
    const installedNames = new Set(installedSkills.map((s) => s.name));
    const requestedSkills = manifest.skills.map((s) => s.skill);
    const preexisting = requestedSkills.filter((name) => installedNames.has(name));

    // 5. Warn about preexisting skills (they will not be overwritten).
    for (const skill of preexisting) {
      console.warn(
        `Warning: skill "${skill}" is already installed and will not be overwritten by this collection.`
      );
    }

    // 6. Install member skills via skills (only those not preexisting).
    const skillsToInstall = requestedSkills.filter((name) => !preexisting.includes(name));

    let installed: InstalledMember[] = [];
    if (skillsToInstall.length > 0) {
      const result = await installCollectionSkills(source, {
        skills: skillsToInstall,
        scope: 'project',
        mode: 'auto',
      });
      installed = [...result.installed];
      if (result.failed.length > 0) {
        for (const failure of result.failed) {
          console.error(`Failed to install skill "${failure.name}": ${failure.message}`);
        }
        return 1;
      }
    }

    // 7. Write kitcrate-lock.json entry.
    const entry: CollectionLockEntry = {
      source: resolved.source,
      ref: resolved.ref ?? 'HEAD',
      commit: resolved.commit,
      manifestHash: resolved.manifestHash,
      skills: requestedSkills,
      preexisting,
      ...(requestedSkills.length > 0 && { only: requestedSkills }),
    };

    const updated: Lockfile = {
      version: 1,
      collections: {
        ...lockfile.collections,
        [manifest.name]: entry,
      },
    };

    await writeLockfile(cwd, updated);

    // 8. Output result.
    if (json) {
      console.log(
        JSON.stringify(
          {
            collection: manifest.name,
            source: resolved.source,
            commit: resolved.commit,
            installed: installed.length,
            preexisting: preexisting.length,
          },
          null,
          2
        )
      );
    } else {
      console.log(
        `Added collection "${manifest.name}" from ${resolved.source}@${resolved.ref ?? 'HEAD'} (commit ${resolved.commit.slice(0, 7)})`
      );
      console.log(
        `  Installed ${installed.length} skill(s); ${preexisting.length} preexisting skill(s) left untouched.`
      );
      console.log(`  Lockfile entry written to kitcrate-lock.json.`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to add collection from "${source}": ${message}`);
    return 1;
  }
}

function printAddHelp(): void {
  console.error(`Usage: kitcrate add <source>

Fetch collection.json from a source, install its member skills via skills,
and write an entry to kitcrate-lock.json.

Arguments:
  <source>   Collection source: owner/repo[@ref], github:owner/repo[@ref],
             a git URL, or a local path.

Options:
  --yes     Non-interactive use (skip confirmation prompts)
  --json    Machine-readable output
  --debug   Include stack traces on errors

Example:
  kitcrate add acme/web-security
  kitcrate add github:acme/web-security@v1.2.0`);
}
