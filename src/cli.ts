#!/usr/bin/env node
import { addCommand } from './commands/add.js';
import { installCommand } from './commands/install.js';
import { updateCommand } from './commands/update.js';
import { removeCommand } from './commands/remove.js';
import { listCommand } from './commands/list.js';
import { validateCommand } from './commands/validate.js';
import { createCommand } from './commands/create.js';
import type { CommandOptions } from './core/options.js';

type CommandHandler = (argv: string[], opts: CommandOptions) => Promise<number>;

interface Command {
  readonly handler: CommandHandler;
  readonly description: string;
}

const COMMANDS: Record<string, Command> = {
  add: {
    handler: addCommand,
    description: 'Fetch collection.json, install member skills, write kitcrate-lock.json',
  },
  install: {
    handler: installCommand,
    description: 'Restore all collections from lockfiles; verify manifestHash',
  },
  update: {
    handler: updateCommand,
    description: 'Re-resolve ref, diff manifests, add/remove/bump skills, rewrite lock',
  },
  remove: {
    handler: removeCommand,
    description: 'Remove a collection; delete only skills kitcrate installed itself',
  },
  list: { handler: listCommand, description: 'Show installed collections and their skills' },
  validate: {
    handler: validateCommand,
    description: 'Check collection.json and referenced skills',
  },
  create: {
    handler: createCommand,
    description:
      'Publish flow: scan, validate, write collection.json, git init, tag, gh repo create',
  },
};

/** Print usage to stderr. */
function printUsage(): void {
  const names = Object.keys(COMMANDS).sort().join(', ');
  console.error(`Usage: kitcrate <command> [args]

Commands:
  ${names}

Options:
  --yes            Non-interactive use (skip confirmation prompts)
  --json           Machine-readable output
  --debug          Include stack traces on errors
  --allow-secrets  Publish even when the secret scan finds something

Run \`kitcrate <command> --help\` for command-specific help.`);
}

/** Parse CLI flags from argv. */
function parseFlags(argv: string[]): CommandOptions & { args: string[] } {
  const args: string[] = [];
  let yes = false;
  let json = false;
  let debug = false;
  let allowSecrets = false;
  for (const arg of argv) {
    if (arg === '--yes') yes = true;
    else if (arg === '--json') json = true;
    else if (arg === '--debug') debug = true;
    else if (arg === '--allow-secrets') allowSecrets = true;
    else args.push(arg);
  }
  return { yes, json, debug, allowSecrets, args };
}

/** Main entry point. */
export async function main(argv: string[]): Promise<number> {
  const { yes, json, debug, allowSecrets, args } = parseFlags(argv);

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

  try {
    return await command.handler(commandArgs, { yes, json, debug, allowSecrets });
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
