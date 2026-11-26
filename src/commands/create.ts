import { readdir, stat, readFile, writeFile } from 'fs/promises';
import { basename, join, relative, sep } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isCredentialFileName, scanFilesForSecrets, scanForSecrets } from '../core/secrets.js';
import { ensureEnvIgnoreRules } from '../core/gitignore.js';
import { type CollectionManifest } from '../core/manifest.js';
import { computeManifestHash } from '../core/hash.js';
import {
  git,
  hasCommits,
  listCommittedFiles,
  listTrackedFiles,
  stagePaths,
  unstagePath,
} from '../git/index.js';
import type { CommandOptions } from '../core/options.js';

const execFileAsync = promisify(execFile);

/** Handle the `kitcrate create` command. */
export async function createCommand(argv: string[], options: CommandOptions): Promise<number> {
  const { yes, json, allowSecrets } = options;
  const sourceDir = argv[0] ?? process.cwd();

  try {
    // 1. Scan the folder for directories containing SKILL.md.
    const skillDirs = await scanSkillDirectories(sourceDir);
    if (skillDirs.length === 0) {
      console.error(
        `No skills found in ${sourceDir}. Each skill must be in a directory with SKILL.md.`
      );
      return 1;
    }

    // 2. Validate each skill.
    const skills: Array<{ dir: string; name: string; description: string }> = [];
    const errors: string[] = [];

    for (const skillDir of skillDirs) {
      try {
        const skill = await readSkill(skillDir);
        skills.push(skill);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${skillDir}: ${message}`);
      }
    }

    if (errors.length > 0) {
      console.error(`Validation errors:`);
      for (const e of errors) {
        console.error(`  ✗ ${e}`);
      }
      return 1;
    }

    // 3. Select skills to include (all by default).
    const selectedSkills = skills;

    // 4. Prompt for name, description, visibility.
    const parts = sourceDir.split(sep).filter(Boolean);
    const defaultName = parts[parts.length - 1] ?? 'collection';
    const defaultVisibility = 'private';

    let name: string;
    let description: string;
    let visibility: 'private' | 'public';

    if (yes || json) {
      name = defaultName;
      description = `Collection of ${selectedSkills.length} skill(s)`;
      visibility = defaultVisibility;
    } else {
      name = (await promptInput(`Collection name [${defaultName}]: `)) || defaultName;
      description =
        (await promptInput('Description: ')) || `Collection of ${selectedSkills.length} skill(s)`;
      const visInput =
        (await promptInput(`Visibility (private/public) [${defaultVisibility}]: `)) ||
        defaultVisibility;
      if (visInput !== 'private' && visInput !== 'public') {
        console.error(`Invalid visibility: "${visInput}". Must be 'private' or 'public'.`);
        return 1;
      }
      visibility = visInput;

      if (visibility === 'public') {
        const confirm = await promptInput('Publishing publicly. Type "public" to confirm: ');
        if (confirm !== 'public') {
          console.error('Publication cancelled: public visibility not confirmed.');
          return 1;
        }
      }
    }

    // Validate name format.
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) {
      console.error(
        `Invalid collection name: "${name}". Must be lowercase, alphanumeric, with hyphens between segments.`
      );
      return 1;
    }

    // 5. Tell git to ignore env and credential files before anything is staged.
    const gitignoreStatus = await ensureEnvIgnoreRules(sourceDir);

    // 6. Scan the working tree for secrets before anything is written.
    const scanResult = await scanForSecrets(sourceDir);
    const blockingFindings = scanResult.findings.filter(
      (f) => !isCredentialFileName(basename(f.path))
    );
    if (blockingFindings.length > 0 && !allowSecrets) {
      console.error(
        `Secret scan blocked publish. Found ${blockingFindings.length} potential secret(s):`
      );
      for (const f of blockingFindings) {
        console.error(`  ✗ ${f.path}: ${f.message}`);
      }
      console.error('Remove the secrets, or pass --allow-secrets to publish anyway.');
      return 1;
    }

    // 7. Write collection.json.
    const manifest: CollectionManifest = {
      name,
      version: '0.1.0',
      description,
      skills: selectedSkills.map((s) => ({
        source: '.', // local path reference
        skill: s.name,
      })),
    };

    const collectionJson = JSON.stringify(manifest, null, 2) + '\n';
    const manifestHash = computeManifestHash(collectionJson);

    await writeFile(join(sourceDir, 'collection.json'), collectionJson, 'utf8');

    // 8. git init, then stage only what belongs in the collection.
    await git(['init'], sourceDir);

    const skillPaths = selectedSkills.map((s) => relative(sourceDir, s.dir));
    await stagePaths(sourceDir, ['collection.json', '.gitignore', ...skillPaths]);

    // 9. Publish gate: nothing credential-shaped may reach the remote.
    const excluded = await excludeCredentialFiles(sourceDir);
    if (excluded.length > 0) {
      console.log(`Excluded ${excluded.length} credential file(s) from the publish:`);
      for (const path of excluded) {
        console.log(`  - ${path}`);
      }
    }

    const tracked = await listTrackedFiles(sourceDir);
    const contentFindings = await scanFilesForSecrets(sourceDir, tracked);
    if (!contentFindings.clean && !allowSecrets) {
      console.error(
        `Publish blocked: ${contentFindings.findings.length} secret(s) in files that would be pushed:`
      );
      for (const f of contentFindings.findings) {
        console.error(`  ✗ ${f.path}: ${f.message}`);
      }
      console.error('Remove the secrets, or pass --allow-secrets to publish anyway.');
      return 1;
    }

    // 10. Refuse to publish a history that already contains credentials.
    if (await hasCommits(sourceDir)) {
      const committed = await listCommittedFiles(sourceDir);
      const leaked = committed.filter((p) => isCredentialFileName(basename(p)));
      if (leaked.length > 0) {
        console.error(
          `Publish blocked: this repository's history already contains credential file(s):`
        );
        for (const p of leaked) {
          console.error(`  ✗ ${p}`);
        }
        console.error(
          'Publishing would push them. Publish from a clean directory, or purge them from history first.'
        );
        return 1;
      }
    }

    // 11. Commit and tag v0.1.0.
    const commitResult = await git(
      ['commit', '-m', `chore: initial collection ${name} v0.1.0`],
      sourceDir
    );
    if (commitResult.code !== 0) {
      console.error(`Failed to commit: ${commitResult.stderr.trim()}`);
      return 1;
    }
    await git(['tag', 'v0.1.0'], sourceDir);

    // 12. gh repo create.
    const visibilityFlag = visibility === 'public' ? '--public' : '--private';
    try {
      await execFileAsync(
        'gh',
        ['repo', 'create', name, visibilityFlag, '--source', sourceDir, '--push'],
        { encoding: 'utf8', maxBuffer: 1024 * 1024, cwd: sourceDir }
      );
    } catch (error) {
      const stderr =
        error instanceof Error && 'stderr' in error ? String((error as any).stderr) : String(error);
      console.error(`Failed to create GitHub repo: ${stderr}`);
      return 1;
    }

    // 13. Print install command.
    console.log(`\nCollection "${name}" published (v0.1.0).`);
    console.log(`  manifestHash: ${manifestHash}`);
    console.log(`  .gitignore: ${gitignoreStatus}`);
    if (excluded.length > 0) {
      console.log(`  excluded from publish: ${excluded.join(', ')}`);
    }
    console.log(`\nInstall with:`);
    console.log(`  kitcrate add github:<user>/${name}`);

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create collection: ${message}`);
    return 1;
  }
}

/** Directories to skip during skill discovery. */
const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
]);

/** Maximum directory depth to search for SKILL.md (matches skills CLI convention). */
const MAX_SKILL_DEPTH = 4;

/** Recursively scan a directory tree for folders containing SKILL.md. */
/**
 * Remove credential files from the git index so they stay on disk but are never
 * pushed. Returns the paths that were excluded.
 */
async function excludeCredentialFiles(sourceDir: string): Promise<string[]> {
  const tracked = await listTrackedFiles(sourceDir);
  const credentialFiles = tracked.filter((p) => isCredentialFileName(basename(p)));
  for (const path of credentialFiles) {
    await unstagePath(sourceDir, path);
  }
  return credentialFiles;
}

async function scanSkillDirectories(root: string): Promise<string[]> {
  const results: string[] = [];
  await walkDirectory(root, root, 0, results);
  return results.sort();
}

async function walkDirectory(
  root: string,
  dir: string,
  depth: number,
  results: string[]
): Promise<void> {
  if (depth > MAX_SKILL_DEPTH) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRECTORIES.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const skillPath = join(fullPath, 'SKILL.md');

    // If this directory contains SKILL.md, it's a skill folder.
    try {
      await stat(skillPath);
      results.push(fullPath);
      // Don't recurse into a skill folder — its contents are skill files, not more skills.
      continue;
    } catch {
      // Not a skill folder; keep searching deeper.
    }

    // Recurse to find nested skills (e.g. .agents/skills/<name>/SKILL.md).
    await walkDirectory(root, fullPath, depth + 1, results);
  }
}

async function readSkill(dir: string): Promise<{ dir: string; name: string; description: string }> {
  const content = await readFile(join(dir, 'SKILL.md'), 'utf8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    throw new Error('SKILL.md missing YAML frontmatter');
  }
  const frontmatter = frontmatterMatch[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (!nameMatch) {
    throw new Error('SKILL.md missing "name" in frontmatter');
  }
  if (!descMatch) {
    throw new Error('SKILL.md missing "description" in frontmatter');
  }
  return {
    dir,
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
  };
}

async function promptInput(message: string): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
