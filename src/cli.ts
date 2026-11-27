#!/usr/bin/env node
import { addCommand, ADD_USAGE } from './commands/add.js';
import { installCommand, INSTALL_USAGE } from './commands/install.js';
import { updateCommand, UPDATE_USAGE } from './commands/update.js';
import { removeCommand, REMOVE_USAGE } from './commands/remove.js';
import { listCommand, LIST_USAGE } from './commands/list.js';
import { validateCommand, VALIDATE_USAGE } from './commands/validate.js';
import { createCommand, CREATE_USAGE } from './commands/create.js';
import type { CommandOptions } from './core/options.js';

type CommandHandler = (argv: string[], opts: CommandOptions) => Promise<number>;

interface Command {
  readonly handler: CommandHandler;
  readonly description: string;
  readonly usage: string;
}

const COMMANDS: Record<string, Command> = {
  add: {
    handler: addCommand,
    description: 'Fetch collection.json, install member skills, write kitcrate-lock.json',
    usage: ADD_USAGE,
  },
  install: {
    handler: installCommand,
    description: 'Restore all collections from lockfiles; verify manifestHash',
    usage: INSTALL_USAGE,
  },
  update: {
    handler: updateCommand,
    description: 'Re-resolve ref, diff manifests, add/remove/bump skills, rewrite lock',
    usage: UPDATE_USAGE,
  },
  remove: {
    handler: removeCommand,
    description: 'Remove a collection; delete only skills kitcrate installed itself',
    usage: REMOVE_USAGE,
  },
  list: {
    handler: listCommand,
    description: 'Show installed collections and their skills',
    usage: LIST_USAGE,
  },
  validate: {
    handler: validateCommand,
    description: 'Check collection.json and referenced skills',
    usage: VALIDATE_USAGE,
  },
  create: {
    handler: createCommand,
    description:
      'Publish flow: scan, validate, write collection.json, git init, tag, gh repo create',
    usage: CREATE_USAGE,
  },
};

/** Print usage to stderr. */
function printUsage(): void {
  const names = Object.keys(COMMANDS).sort().join(', ');
  console.error(`Usage: kitcrate <command> [args]

Commands:
  ${names}

Options:
  --yes      Non-interactive use (skip confirmation prompts)
  --json     Machine-readable output
  --global   Install skills into ~/.agents/skills instead of the project (add only)
  --debug    Include stack traces on errors

Run \`kitcrate <command> --help\` for command-specific help.`);
}

/** Parse CLI flags from argv. */
function parseFlags(argv: string[]): CommandOptions & { args: string[] } {
  const args: string[] = [];
  let yes = false;
  let json = false;
  let debug = false;
  let global = false;
  for (const arg of argv) {
    if (arg === '--yes') yes = true;
    else if (arg === '--json') json = true;
    else if (arg === '--debug') debug = true;
    else if (arg === '--global') global = true;
    // Secret findings never block a publish, so this flag has nothing left to
    // do. It is still accepted so scripts written against the old behaviour
    // keep working.
    else if (arg === '--allow-secrets') continue;
    else args.push(arg);
  }
  return { yes, json, debug, global, args };
}

/** Main entry point. */
export async function main(argv: string[]): Promise<number> {
  const { yes, json, debug, global, args } = parseFlags(argv);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return args.length === 0 ? 1 : 0;
  }

  const [name, ...commandArgs] = args;
  const command = COMMANDS[name];
  if (!command) {
    console.error(`Unknown command: ${name}`);
    console.error(`Run \`kitcrate --help\` for available commands.`);
    return 1;
  }

  // Every command answers --help the same way, so the flag never reaches a
  // command as an argument it would try to act on.
  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    console.error(command.usage);
    return 0;
  }

  try {
    return await command.handler(commandArgs, { yes, json, debug, global });
  } catch (error) {
    if (debug) {
      console.error(error);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
    }
    return 1;
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
