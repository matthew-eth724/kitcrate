import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishCommand } from '../src/commands/publish.js';
import { parseCollectionManifest } from '../src/core/manifest.js';
import { git } from '../src/git/index.js';
import * as adapter from '../src/skills/index.js';
import type { ListedSkill } from '../src/skills/index.js';

/** The collection this suite publishes, as its lockfile entries record it. */
const COLLECTION_REPO = 'fixture/web-security';

/** Write a skill folder: a SKILL.md naming `name`, plus any extra files. */
async function writeSkill(
  dir: string,
  name: string,
  extra: Readonly<Record<string, string>> = {}
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n# ${name}\n`,
    'utf8'
  );
  for (const [path, contents] of Object.entries(extra)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
}

/**
 * A stand-in for `gh`. `api repos/<owner>/<repo>` answers the push-permission
 * probe with `$GH_CAN_PUSH`, `api user` names the logged-in account, and
 * `repo create` records the name, flags, source and remote it was asked for.
 *
 * `repo create` adds the remote but does not push, so the test can tell the
 * command's own tag push from the one gh would do.
 */
const GH_STUB = `#!/bin/sh
log="$GH_STUB_LOG"
case "$1" in
  api)
    case "$2" in
      user) echo "stub-user"; exit 0 ;;
      repos/*) echo "\${GH_CAN_PUSH:-false}"; exit 0 ;;
    esac
    exit 0 ;;
  repo)
    shift
    [ "$1" = "create" ] || exit 1
    shift
    name="$1"; shift
    printf 'create %s' "$name" >> "$log"
    source_dir=""
    remote="origin"
    while [ $# -gt 0 ]; do
      case "$1" in
        --source) source_dir="$2"; shift 2 ;;
        --remote|-r) remote="$2"; shift 2 ;;
        --private|--public) printf ' %s' "$1" >> "$log"; shift ;;
        --push) printf ' --push' >> "$log"; shift ;;
        *) shift ;;
      esac
    done
    printf ' remote=%s source=%s\\n' "$remote" "$source_dir" >> "$log"
    exit 0 ;;
esac
exit 1
`;

describe('publishCommand', () => {
  let root: string;
  let remoteDir: string;
  let projectDir: string;
  let binDir: string;
  let originalPath: string | undefined;
  let originalEnv: Record<string, string | undefined>;

  /** A bare repository standing in for the collection's remote. */
  let bare: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kitcrate-publish-'));
    remoteDir = join(root, 'remote');
    projectDir = join(root, 'project');
    binDir = await mkdtemp(join(tmpdir(), 'kitcrate-bin-'));
    bare = join(root, 'collection.git');

    originalEnv = {
      configCount: process.env['GIT_CONFIG_COUNT'],
      configKey: process.env['GIT_CONFIG_KEY_0'],
      configValue: process.env['GIT_CONFIG_VALUE_0'],
      author: process.env['GIT_AUTHOR_NAME'],
      email: process.env['GIT_AUTHOR_EMAIL'],
      committer: process.env['GIT_COMMITTER_NAME'],
      committerEmail: process.env['GIT_COMMITTER_EMAIL'],
    };
    process.env['GIT_AUTHOR_NAME'] = 'kitcrate test';
    process.env['GIT_AUTHOR_EMAIL'] = 'test@kitcrate.local';
    process.env['GIT_COMMITTER_NAME'] = 'kitcrate test';
    process.env['GIT_COMMITTER_EMAIL'] = 'test@kitcrate.local';

    // 1. A collection repository with two members, published to a bare remote.
    await writeSkill(join(remoteDir, '.agents', 'skills', 'alpha'), 'alpha');
    await writeSkill(join(remoteDir, '.agents', 'skills', 'beta'), 'beta', {
      'references/notes.md': '# notes\n',
    });
    await writeFile(
      join(remoteDir, 'collection.json'),
      JSON.stringify(
        {
          name: 'web-security',
          version: '0.1.0',
          description: 'Web app security review skills',
          skills: [
            { source: '.', skill: 'alpha' },
            { source: 'acme/shared-skills', skill: 'remote-skill' },
          ],
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    await git(['init'], remoteDir);
    await git(['add', '--', 'collection.json', '.agents'], remoteDir);
    await git(['commit', '-m', 'chore: initial collection web-security v0.1.0'], remoteDir);
    await git(['tag', 'v0.1.0'], remoteDir);
    await git(['clone', '--bare', remoteDir, bare]);
    // The fixture keeps editing the source repository and pushing from it.
    await git(['remote', 'add', 'origin', bare], remoteDir);

    // The collection's source is a GitHub repository, as an installed
    // collection's always is; git's insteadOf puts the local bare repository in
    // its place so the test never reaches the network.
    process.env['GIT_CONFIG_COUNT'] = '1';
    process.env['GIT_CONFIG_KEY_0'] = `url.${bare}.insteadOf`;
    process.env['GIT_CONFIG_VALUE_0'] = `https://github.com/${COLLECTION_REPO}.git`;

    // 2. A project that installed the collection from that remote.
    await mkdir(join(projectDir, '.agents', 'skills'), { recursive: true });
    await writeFile(
      join(projectDir, 'kitcrate-lock.json'),
      JSON.stringify(
        {
          version: 1,
          collections: {
            'web-security': {
              source: `github:${COLLECTION_REPO}`,
              ref: 'master',
              commit: 'abc123',
              manifestHash: 'sha256-abc',
              skills: ['alpha'],
              preexisting: [],
              scope: 'project',
            },
          },
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    // 3. The project's installed copies: alpha changed, and gamma is installed
    //    but is not a member of the collection yet.
    await writeSkill(join(projectDir, '.agents', 'skills', 'alpha'), 'alpha', {
      'references/api.md': '# the local copy\n',
    });
    await writeSkill(join(projectDir, '.agents', 'skills', 'gamma'), 'gamma', {
      'scripts/run.sh': '#!/bin/sh\necho gamma\n',
    });

    originalPath = process.env['PATH'];
    process.env['PATH'] = `${binDir}:${originalPath ?? ''}`;
    process.env['GH_STUB_LOG'] = join(root, 'gh.log');
    process.env['GH_CAN_PUSH'] = 'true';
    await writeFile(join(root, 'gh.log'), '', 'utf8');
    await writeGhStub(GH_STUB);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (originalPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = originalPath;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  async function writeGhStub(script: string): Promise<void> {
    const ghStub = join(binDir, 'gh');
    await writeFile(ghStub, script, 'utf8');
    await chmod(ghStub, 0o755);
  }

  /** A stand-in for what the `skills` lock file reports for an installed skill. */
  function installedIn(scope: 'project' | 'global', name: string, path: string): ListedSkill {
    return {
      name,
      description: `The ${name} skill`,
      scope,
      path,
      agents: ['claude-code'],
      agentNames: ['Claude Code'],
    };
  }

  /** Report the project's own installed copies, and nothing global. */
  function stubProjectSkills(): void {
    vi.spyOn(adapter, 'listInstalledSkills').mockImplementation(async (options = {}) => {
      if (options.scope === 'global') return [];
      const skills = join(projectDir, '.agents', 'skills');
      return [
        installedIn('project', 'alpha', join(skills, 'alpha')),
        installedIn('project', 'gamma', join(skills, 'gamma')),
      ];
    });
  }

  /** Run publish from the project directory, capturing what it printed. */
  async function runPublish(
    argv: string[] = []
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      err.push(args.map(String).join(' '));
    });
    vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
    const code = await publishCommand(argv, { yes: true, json: true, debug: false, global: false });
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
  }

  it('reports clearly when there is no collection to publish', async () => {
    vi.spyOn(adapter, 'listInstalledSkills').mockResolvedValue([]);
    await rm(join(projectDir, 'kitcrate-lock.json'));

    const { code, stderr } = await runPublish();

    expect(code).toBe(1);
    expect(stderr).toContain('No collections to publish');
    expect(stderr).toContain('kitcrate create');
  });

  it('publishes the new skill and the changed member to the collection’s own repository', async () => {
    stubProjectSkills();

    const { code, stdout, stderr } = await runPublish(['web-security']);

    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout) as {
      version: string;
      destination: { kind: string; repo: string };
      added: Array<{ name: string; path: string }>;
      updated: Array<{ name: string }>;
    };
    expect(result.version).toBe('0.1.1');
    expect(result.destination.kind).toBe('same-repository');
    expect(result.added).toEqual([
      expect.objectContaining({ name: 'gamma', path: '.agents/skills/gamma' }),
    ]);
    expect(result.updated.map((member) => member.name)).toEqual(['alpha']);

    // The bare remote received the new commit, the new member, and the updated one.
    const inspect = join(root, 'inspect');
    await git(['clone', bare, inspect]);
    const published = parseCollectionManifest(
      JSON.parse(await readFile(join(inspect, 'collection.json'), 'utf8'))
    );
    expect(published.version).toBe('0.1.1');
    expect(published.skills).toEqual([
      { source: '.', skill: 'alpha' },
      { source: 'acme/shared-skills', skill: 'remote-skill' },
      { source: '.', skill: 'gamma' },
    ]);
    // The new skill landed beside the collection's own members, whole.
    expect(
      await readFile(join(inspect, '.agents', 'skills', 'gamma', 'scripts', 'run.sh'), 'utf8')
    ).toBe('#!/bin/sh\necho gamma\n');
    // The changed member was replaced by the local copy.
    expect(
      await readFile(join(inspect, '.agents', 'skills', 'alpha', 'references', 'api.md'), 'utf8')
    ).toBe('# the local copy\n');

    // The commit and the release tag both reached the bare remote.
    const log = await git(['log', '-1', '--format=%s'], inspect);
    expect(log.stdout.trim()).toBe('chore: collection web-security v0.1.1');
    const tag = await git(['--git-dir', bare, 'rev-list', '-n', '1', 'v0.1.1']);
    const head = await git(['--git-dir', bare, 'rev-parse', 'master']);
    expect(tag.stdout.trim()).toBe(head.stdout.trim());
  });

  it('never writes to the project it was run from', async () => {
    stubProjectSkills();
    const before = await git(['status', '--porcelain', '-z'], projectDir);

    expect((await runPublish(['web-security'])).code).toBe(0);

    const after = await git(['status', '--porcelain', '-z'], projectDir);
    expect(after.stdout).toBe(before.stdout);
    // Nothing was staged, committed, or added under the project.
    const local = await git(['rev-parse', '--verify', 'HEAD'], projectDir);
    expect(local.code).not.toBe(0);
  });

  it('reports a member from another repository instead of copying it', async () => {
    // The collection carries a folder for a member it installs from elsewhere.
    // Consumers fetch that member from its own repository, so this folder is
    // not what they read.
    await writeSkill(join(remoteDir, '.agents', 'skills', 'remote-skill'), 'remote-skill');
    await git(['add', '--', '.agents'], remoteDir);
    await git(['commit', '-m', 'chore: collection web-security v0.1.1'], remoteDir);
    await git(['push', '--force', 'origin', 'master'], remoteDir);

    // Locally, that member's copy has been edited. alpha's is too, so there is
    // still something to publish.
    await writeSkill(join(projectDir, '.agents', 'skills', 'remote-skill'), 'remote-skill', {
      'references/local.md': '# edited here\n',
    });
    await rm(join(projectDir, '.agents', 'skills', 'gamma'), { recursive: true, force: true });
    vi.spyOn(adapter, 'listInstalledSkills').mockImplementation(async (options = {}) => {
      if (options.scope === 'global') return [];
      const skills = join(projectDir, '.agents', 'skills');
      return [
        installedIn('project', 'alpha', join(skills, 'alpha')),
        installedIn('project', 'remote-skill', join(skills, 'remote-skill')),
      ];
    });

    const { code, stdout, stderr } = await runPublish(['web-security']);

    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout) as {
      leftAlone: Array<{ skill: string; reason: string }>;
      updated: Array<{ name: string }>;
    };
    expect(result.updated.map((member) => member.name)).toEqual(['alpha']);
    const diagClone = join(root, 'diag-clone');
    await git(['clone', bare, diagClone]);
    const names = await git(['ls-files'], diagClone);
    await (
      await import('fs/promises')
    ).writeFile(
      '/tmp/kc-diag.json',
      JSON.stringify({ stdout: JSON.parse(stdout), files: names.stdout, stderr }, null, 1)
    );
    expect(result.leftAlone).toHaveLength(1);
    const [reported] = result.leftAlone;
    expect(reported?.skill).toBe('remote-skill');
    // The report says where the change belongs: the member's own repository.
    expect(reported?.reason).toContain('acme/shared-skills');
    expect(reported?.reason).toContain('that repository');

    // The collection's copy of that member was not touched.
    const inspect = join(root, 'inspect');
    await git(['clone', bare, inspect]);
    await expect(
      readFile(join(inspect, '.agents', 'skills', 'remote-skill', 'references', 'local.md'), 'utf8')
    ).rejects.toThrow(/ENOENT/);
  });

  it('publishes to a new private repository under the user’s account when it cannot push', async () => {
    stubProjectSkills();
    process.env['GH_CAN_PUSH'] = 'false';

    const { code, stdout } = await runPublish(['web-security']);

    expect(code).toBe(0);
    const result = JSON.parse(stdout) as {
      destination: { kind: string; repo: string; remote: string };
    };
    expect(result.destination).toEqual({
      kind: 'new-repository',
      repo: 'stub-user/web-security',
      remote: 'github',
    });

    // gh was asked for a new repository under the user's account, named after
    // the collection, private, and under a remote name that is not origin.
    const log = (await readFile(join(root, 'gh.log'), 'utf8')).trim();
    expect(log).toContain('create web-security');
    expect(log).toContain('--private');
    expect(log).toContain('--push');
    expect(log).toContain('remote=github');
    // The old repository is still origin.
    expect(log).not.toContain('remote=origin');
  });

  it('publishes to a new repository when the source is not a GitHub repository', async () => {
    stubProjectSkills();
    // A local path names no repository `gh api` could report permissions on, so
    // there is no collection repository this user could push to.
    await writeFile(
      join(projectDir, 'kitcrate-lock.json'),
      JSON.stringify(
        {
          version: 1,
          collections: {
            'web-security': {
              source: bare,
              ref: 'master',
              commit: 'abc123',
              manifestHash: 'sha256-abc',
              skills: ['alpha'],
              preexisting: [],
              scope: 'project',
            },
          },
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    const { code, stdout } = await runPublish(['web-security']);

    expect(code).toBe(0);
    const result = JSON.parse(stdout) as { destination: { kind: string } };
    expect(result.destination.kind).toBe('new-repository');
  });

  it('says there is nothing to publish when nothing was added or changed', async () => {
    // The project holds exactly what the collection already has.
    vi.spyOn(adapter, 'listInstalledSkills').mockImplementation(async (options = {}) => {
      if (options.scope === 'global') return [];
      const skills = join(projectDir, '.agents', 'skills');
      return [installedIn('project', 'alpha', join(skills, 'alpha'))];
    });
    // The project's copy is the collection's copy exactly, so nothing is a change.
    await rm(join(projectDir, '.agents', 'skills', 'alpha'), { recursive: true, force: true });
    await writeSkill(join(projectDir, '.agents', 'skills', 'alpha'), 'alpha');

    const { code, stdout, stderr } = await runPublish(['web-security']);

    expect(code, stderr).toBe(0);
    expect(stderr).toBe('');
    const result = JSON.parse(stdout) as { published: boolean; version: string };
    expect(result.published).toBe(false);
    expect(result.version).toBe('0.1.0');
    // Nothing was pushed.
    const log = await readFile(join(root, 'gh.log'), 'utf8');
    expect(log.trim()).toBe('');
  });

  it('keeps credential files out of the publish', async () => {
    stubProjectSkills();
    await writeFile(
      join(projectDir, '.agents', 'skills', 'gamma', '.env'),
      'TOKEN=secret\n',
      'utf8'
    );

    const ran = await runPublish(['web-security']);
    expect(ran.code, ran.stderr).toBe(0);

    const inspect = join(root, 'inspect');
    await git(['clone', bare, inspect]);
    const files = await git(['ls-files', '-z'], inspect);
    const refs = await git(['--git-dir', bare, 'log', '--all', '--oneline']);
    await writeFile(
      '/tmp/kc-diag.json',
      JSON.stringify({ refs: refs.stdout, stderr: ran.stderr, stdout: ran.stdout }, null, 2)
    );
    expect(files.stdout.split('\0')).not.toContain('.agents/skills/gamma/.env');
    expect(files.stdout).toContain('.agents/skills/gamma/scripts/run.sh');
  });

  it('names the collection to publish when several are installed', async () => {
    stubProjectSkills();
    const lock = JSON.parse(
      await readFile(join(projectDir, 'kitcrate-lock.json'), 'utf8')
    ) as Record<string, unknown>;
    const collections = lock['collections'] as Record<string, unknown>;
    collections['other-collection'] = {
      source: `github:${COLLECTION_REPO}`,
      ref: 'master',
      commit: 'abc123',
      manifestHash: 'sha256-abc',
      skills: ['alpha'],
      preexisting: [],
      scope: 'project',
    };
    await writeFile(
      join(projectDir, 'kitcrate-lock.json'),
      JSON.stringify(lock, null, 2) + '\n',
      'utf8'
    );

    const { code, stdout } = await runPublish(['other-collection']);

    expect(code).toBe(0);
    expect((JSON.parse(stdout) as { collection: string }).collection).toBe('web-security');
  });

  it('refuses a name that is not an installed collection', async () => {
    stubProjectSkills();

    const { code, stderr } = await runPublish(['no-such-collection']);

    expect(code).toBe(1);
    expect(stderr).toContain('No installed collection named "no-such-collection"');
  });
});
