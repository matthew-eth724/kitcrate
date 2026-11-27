import {
  diagnostics,
  getSupportedAgents,
  installSkills,
  listSkills,
  removeSkills,
  resolveSource,
  type Diagnostic,
  type InstallOptions as SkillsInstallOptions,
  type ListOptions as SkillsListOptions,
  type RemoveOptions as SkillsRemoveOptions,
  type ResolveOptions as SkillsResolveOptions,
  type SkillSource,
  type SourceType,
} from 'skills';
import type { InstallScope } from '../core/scope.js';

/** A skill discovered in a collection source. */
export interface ResolvedSkill {
  /** Skill name (from SKILL.md frontmatter). */
  readonly name: string;
  /** Skill description (from SKILL.md frontmatter). */
  readonly description: string;
  /** Path to the skill's SKILL.md within the source, `/`-separated. */
  readonly path?: string;
}

/** A skill discovered inside a local directory. */
export interface DiscoveredSkill {
  readonly name: string;
  readonly description: string;
  /** Path to the skill folder relative to the scanned root, `/`-separated. */
  readonly path: string;
}

/** A resolved collection source, ready to install from. */
export interface ResolvedCollection {
  /** Normalized source identifier. */
  readonly source: string;
  /** Source provider: github, gitlab, git, local, well-known, download. */
  readonly type: SourceType;
  /** Original URL used to re-fetch. */
  readonly url: string;
  /** Branch/tag ref, if any. */
  readonly ref?: string;
  /** Pinned git commit, if a git source was cloned. */
  readonly commit?: string;
  /** Skills discovered in the source. */
  readonly skills: readonly ResolvedSkill[];
}

/** An installed skill member. */
export interface InstalledMember {
  readonly name: string;
  readonly agent: string;
  readonly scope: InstallScope;
  readonly mode: 'symlink' | 'copy';
  readonly path: string;
}

export interface InstallFailure {
  readonly name: string;
  readonly agent: string;
  readonly code: string;
  readonly message: string;
}

export interface InstallCollectionResult {
  readonly source: ResolvedCollection;
  readonly installed: readonly InstalledMember[];
  readonly failed: readonly InstallFailure[];
}

export interface ListedSkill {
  readonly name: string;
  readonly description: string;
  readonly scope: InstallScope;
  /** Installed directory of the skill. */
  readonly path?: string;
  /** Agent ids the skill is installed for, e.g. `claude-code`. */
  readonly agents: readonly string[];
  /** The same agents by display name, e.g. `Claude Code`, in the same order. */
  readonly agentNames: readonly string[];
  /** Source the skill came from, as the lock file records it. */
  readonly source?: string;
}

export interface RemoveCollectionResult {
  readonly removed: readonly string[];
  readonly notFound: readonly string[];
  readonly failed: readonly InstallFailure[];
}

/** Shared runtime context for all adapter operations. */
export interface AdapterOptions {
  /** Project directory. Defaults to process.cwd(). */
  readonly cwd?: string;
  /** Abort signal. */
  readonly signal?: AbortSignal;
  /** Progress events. */
  readonly onProgress?: (event: { readonly type: string; readonly source?: string }) => void;
  /** Non-fatal warnings. */
  readonly onWarning?: (warning: Diagnostic<unknown>) => void;
}

/** Options for installing collection member skills. */
export interface InstallCollectionOptions extends AdapterOptions {
  /** Skill names to install. Defaults to all skills in the source. */
  readonly skills?: readonly string[];
  /** Branch, tag, or commit SHA to install at. Defaults to the source's default branch. */
  readonly ref?: string;
  /** Agents to install into. Defaults to detected agents. */
  readonly agents?: readonly string[];
  /** Install scope. Defaults to 'project'. */
  readonly scope?: InstallScope;
  /** Install mode. Defaults to 'auto'. */
  readonly mode?: 'auto' | 'symlink' | 'copy';
}

/** Options for removing collection member skills. */
export interface RemoveCollectionOptions extends AdapterOptions {
  /** Remove scope. Defaults to 'project'. */
  readonly scope?: InstallScope;
}

/** Resolve a collection source and discover its skills without installing. */
export async function resolveCollection(
  source: string,
  options: AdapterOptions = {}
): Promise<ResolvedCollection> {
  let handle: SkillSource | undefined;
  try {
    handle = await resolveSource(source, {
      cwd: options.cwd,
      signal: options.signal,
      onProgress: options.onProgress,
      onWarning: options.onWarning,
    } as SkillsResolveOptions);

    return {
      source: handle.source.input,
      type: handle.source.type,
      url: handle.source.url,
      ...(handle.source.ref !== undefined && { ref: handle.source.ref }),
      ...(handle.source.commit !== undefined && { commit: handle.source.commit }),
      skills: handle.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        ...(skill.path !== undefined && { path: skill.path }),
      })),
    };
  } finally {
    if (handle) {
      await handle.dispose();
    }
  }
}

/**
 * Discover skills inside a local directory using the `skills` CLI's own
 * discovery, so kitcrate follows the same conventional folders
 * (`.agents/skills/`, `skills/`, `.claude/skills/`, ...) instead of its own walk.
 * A source with no valid skills yields an empty array, not a diagnostic.
 */
export async function discoverSkillsInDirectory(
  root: string,
  options: AdapterOptions = {}
): Promise<readonly DiscoveredSkill[]> {
  let handle: SkillSource | undefined;
  try {
    handle = await resolveSource(root, {
      cwd: options.cwd,
      signal: options.signal,
      onProgress: options.onProgress,
      onWarning: options.onWarning,
    } as SkillsResolveOptions);
  } catch (error) {
    if (isSkillsDiagnostic(error) && error.code === 'SKILLS_NO_VALID_SKILLS') {
      return [];
    }
    throw error;
  }

  try {
    return handle.skills.flatMap((skill) =>
      skill.path === undefined
        ? []
        : [{ name: skill.name, description: skill.description, path: skill.path }]
    );
  } finally {
    await handle.dispose();
  }
}

/** Install member skills from a collection source string. */
export async function installCollectionSkills(
  source: string,
  options: InstallCollectionOptions = {}
): Promise<InstallCollectionResult> {
  const result = await installSkills(source, {
    cwd: options.cwd,
    signal: options.signal,
    onProgress: options.onProgress,
    onWarning: options.onWarning,
    scope: options.scope ?? 'project',
    mode: options.mode ?? 'auto',
    skills: options.skills,
    agents: options.agents,
    ...(options.ref !== undefined && { ref: options.ref }),
    lockfile: true,
  } as SkillsInstallOptions);

  return {
    source: {
      source: result.source.input,
      type: result.source.type,
      url: result.source.url,
      ...(result.source.ref !== undefined && { ref: result.source.ref }),
      ...(result.source.commit !== undefined && { commit: result.source.commit }),
      skills: [],
    },
    installed: result.installed.map((t) => ({
      name: t.skill,
      agent: t.agent,
      scope: t.scope,
      mode: t.mode,
      path: t.path,
    })),
    failed: result.failed.map((f) => ({
      name: f.skill,
      agent: f.agent,
      code: f.code,
      message: f.message,
    })),
  };
}

/** Options for listing installed skills. */
export interface ListInstalledOptions extends AdapterOptions {
  /**
   * Which scopes to read. Both scopes by default, because the add and install
   * paths need to spot a skill that already exists in the other scope. Reading
   * one scope is much cheaper: the global scope holds a copy of every skill for
   * every agent on the machine.
   */
  readonly scope?: 'project' | 'global' | 'all';
}

/** List installed skills with source provenance from the lock file. */
export async function listInstalledSkills(
  options: ListInstalledOptions = {}
): Promise<readonly ListedSkill[]> {
  const result = await listSkills({
    cwd: options.cwd,
    signal: options.signal,
    onWarning: options.onWarning,
    scope: options.scope ?? 'all',
  } as SkillsListOptions);

  return result.skills.map((s) => ({
    name: s.name,
    description: s.description,
    scope: s.scope,
    ...(s.path !== undefined && { path: s.path }),
    agents: s.agents,
    agentNames: s.agents.map(agentDisplayName),
    ...(s.source !== undefined && { source: s.source }),
  }));
}

/**
 * Display name for an agent id. The `skills` package owns the mapping, and this
 * module is the only place allowed to reach into it; an unknown id (a newer
 * `skills` than this mapping knows) falls back to the id rather than blank.
 */
export function agentDisplayName(id: string): string {
  return getSupportedAgents().find((agent) => agent.id === id)?.name ?? id;
}

/** Remove installed skills by name. */
export async function removeCollectionSkills(
  names: readonly string[],
  options: RemoveCollectionOptions = {}
): Promise<RemoveCollectionResult> {
  const result = await removeSkills(names, {
    cwd: options.cwd,
    signal: options.signal,
    onWarning: options.onWarning,
    scope: options.scope ?? 'project',
    lockfile: true,
  } as SkillsRemoveOptions);

  return {
    removed: result.removed,
    notFound: result.notFound,
    failed: result.failed.map((f) => ({
      name: f.skill,
      agent: '',
      code: f.code,
      message: f.message,
    })),
  };
}

/**
 * Type guard: check whether an error is any diagnostics-catalog error thrown by
 * `skills`. The exported `isDiagnostic` helper is the deprecated variant whose
 * guard only narrows when codes are passed explicitly, so it always returns
 * false for a bare check; the catalog predicate is the correct one.
 */
export function isSkillsDiagnostic(error: unknown): error is Diagnostic<unknown> {
  return diagnostics.is(error);
}

export { diagnostics };
