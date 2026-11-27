import { readFile } from 'fs/promises';
import { parseCollectionManifest, type CollectionManifest } from '../core/manifest.js';
import { resolveCollection } from '../core/resolve.js';
import type { CommandOptions } from '../core/options.js';

/** Usage text for `kitcrate validate`. */
export const VALIDATE_USAGE = `Usage: kitcrate validate [path]

Check a collection.json and the skills it references, reporting every problem
found. Defaults to ./collection.json.

Arguments:
  [path]   Path to the collection.json to check.

Options:
  --json    Machine-readable output
  --debug   Include stack traces on errors`;

/** Handle the `kitcrate validate [path]` command. */
export async function validateCommand(argv: string[], options: CommandOptions): Promise<number> {
  const { json } = options;
  const path = argv[0] ?? './collection.json';

  try {
    // 1. Read and parse collection.json.
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error(`collection.json not found at: ${path}`);
        return 1;
      }
      throw error;
    }

    let manifest: CollectionManifest;
    try {
      manifest = parseCollectionManifest(JSON.parse(raw));
    } catch (error) {
      console.error(`Invalid collection.json at ${path}:`);
      if (error instanceof Error) {
        console.error(`  ${error.message}`);
      } else {
        console.error(`  ${String(error)}`);
      }
      return 1;
    }

    // 2. Validate each referenced skill exists in its source.
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const skillRef of manifest.skills) {
      const source = skillRef.ref ? `${skillRef.source}@${skillRef.ref}` : skillRef.source;
      try {
        const resolved = await resolveCollection(source);
        const found = resolved.manifest.skills.some((s) => s.skill === skillRef.skill);
        if (!found) {
          errors.push(`Skill "${skillRef.skill}" not found in source "${skillRef.source}"`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Could not resolve source "${skillRef.source}": ${message}`);
      }
    }

    // 3. Output results.
    if (json) {
      console.log(
        JSON.stringify(
          {
            path,
            valid: errors.length === 0,
            manifest: {
              name: manifest.name,
              version: manifest.version,
              description: manifest.description,
              skillCount: manifest.skills.length,
            },
            skills: manifest.skills.map((s) => ({
              source: s.source,
              skill: s.skill,
              ref: s.ref,
            })),
            errors,
            warnings,
          },
          null,
          2
        )
      );
      return errors.length === 0 ? 0 : 1;
    }

    console.log(`Validating ${path}...`);
    console.log(`  name: ${manifest.name}`);
    console.log(`  version: ${manifest.version}`);
    console.log(`  description: ${manifest.description}`);
    console.log(`  skills: ${manifest.skills.length}`);

    if (errors.length > 0) {
      console.error(`\n${errors.length} error(s):`);
      for (const e of errors) {
        console.error(`  ✗ ${e}`);
      }
    }

    if (warnings.length > 0) {
      console.warn(`\n${warnings.length} warning(s):`);
      for (const w of warnings) {
        console.warn(`  ! ${w}`);
      }
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`\n✓ collection.json is valid (${manifest.skills.length} skill(s) referenced).`);
    } else if (errors.length === 0) {
      console.log(`\n⚠ collection.json is valid but has ${warnings.length} warning(s).`);
    } else {
      console.error(`\n✗ collection.json is invalid (${errors.length} error(s)).`);
      return 1;
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to validate ${path}: ${message}`);
    return 1;
  }
}
