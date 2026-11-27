/** Options every command receives from the CLI. */
export interface CommandOptions {
  /** Non-interactive mode: skip confirmation prompts. */
  readonly yes: boolean;
  /** Machine-readable output. */
  readonly json: boolean;
  /** Include stack traces on errors. */
  readonly debug: boolean;
  /**
   * Install into the user's home `.agents/skills` instead of the project's.
   * Only `add` acts on it; the other commands read the scope from the lockfile,
   * so the flag is parsed once rather than per command.
   */
  readonly global: boolean;
}
