import { execFile } from 'child_process';

/**
 * An external program kitcrate shells out to. kitcrate does not reimplement
 * git, and it delegates GitHub access to `gh` rather than holding a token of
 * its own, so a command that needs one of these cannot start without it.
 */
export type Tool = 'git' | 'gh';

/**
 * Why a command needs each tool, for the message when it is missing. The reason
 * is per command: `add` fetches a repository, but `remove` only ever deletes
 * skills it already installed, and saying otherwise would mislead.
 */
const TOOL_PURPOSE: Record<string, Partial<Record<Tool, string>>> = {
  add: { git: 'to clone the collection and read its manifest' },
  install: { git: 'to clone each collection and read its manifest' },
  update: { git: 'to re-resolve each collection and diff its manifest' },
  remove: { git: 'to delete the skills it installed' },
  create: {
    git: 'to commit the collection and tag its release',
    gh: 'to create the GitHub repository',
  },
  publish: {
    git: 'to clone the collection, commit the change, and push it',
    gh: 'to check where you may push, and to publish a new repository when you may not',
  },
};

/** The reason this command needs this tool, with a fallback for an undeclared one. */
function purposeOf(command: string, tool: Tool): string {
  return (
    TOOL_PURPOSE[command]?.[tool] ??
    (tool === 'gh' ? 'to reach GitHub' : 'to work with the repository')
  );
}

/** Where to get each tool, for the message. */
const TOOL_HELP: Record<Tool, string> = {
  git: 'Install it from https://git-scm.com/downloads',
  gh: 'Install it from https://cli.github.com, then run `gh auth login`',
};

/** The tools each command runs, by command name. */
const COMMAND_TOOLS: Record<string, readonly Tool[]> = {
  add: ['git'],
  install: ['git'],
  update: ['git'],
  remove: ['git'],
  create: ['git', 'gh'],
  publish: ['git', 'gh'],
  list: [],
  validate: [],
};

/** True when a program of this name answers on PATH. */
export function hasTool(tool: Tool): Promise<boolean> {
  // `--version` answers for both programs, never touches the network, and never
  // depends on a repository, so it is safe to run anywhere and cheap.
  return new Promise((resolve) => {
    execFile(tool, ['--version'], { encoding: 'utf8', timeout: 10_000 }, (error) => {
      resolve(error === null);
    });
  });
}

/** What a preflight found: the tools that are there, and the ones that are not. */
export interface ToolCheck {
  readonly missing: readonly Tool[];
  /** True when every tool the command needs was found. */
  readonly ok: boolean;
}

/**
 * Check for the tools a command needs, without running the command.
 *
 * An unknown command needs nothing: the dispatcher reports an unknown command
 * itself, and guessing a tool set for it would produce the wrong message.
 */
export async function checkTools(
  command: string,
  probe: (tool: Tool) => Promise<boolean> = hasTool
): Promise<ToolCheck> {
  const needed = COMMAND_TOOLS[command] ?? [];
  const results = await Promise.all(
    needed.map(async (tool) => ({ tool, present: await probe(tool) }))
  );
  const missing = results.filter((result) => !result.present).map((result) => result.tool);
  return { missing, ok: missing.length === 0 };
}

/**
 * What to print when a command cannot run, or null when every tool it needs is
 * there. The message names the tool, says why this command wants it, and
 * says how to get it, because the failure it replaces was a blank one.
 */
export function missingToolsMessage(command: string, check: ToolCheck): string | null {
  if (check.ok) return null;

  const lines: string[] = [];
  for (const tool of check.missing) {
    lines.push(`  - ${tool}: \`kitcrate ${command}\` needs it ${purposeOf(command, tool)}`);
    lines.push(`    ${TOOL_HELP[tool]}, then retry.`);
  }

  return `kitcrate ${command} cannot run:\n${lines.join('\n')}`;
}
