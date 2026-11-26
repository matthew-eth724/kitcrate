/** Options every command receives from the CLI. */
export interface CommandOptions {
  /** Non-interactive mode: skip confirmation prompts. */
  readonly yes: boolean;
  /** Machine-readable output. */
  readonly json: boolean;
  /** Include stack traces on errors. */
  readonly debug: boolean;
  /** Publish despite secret-pattern findings inside skill content. */
  readonly allowSecrets: boolean;
}
