import { styleText } from 'node:util';
import { MultiSelectPrompt, settings, wrapTextWithPrefix } from '@clack/core';
import {
  MULTISELECT_INSTRUCTIONS,
  S_BAR,
  formatInstructionFooter,
  isCancel,
  limitOptions,
  symbol,
  symbolBar,
} from '@clack/prompts';

/** An unticked skill. */
const EMPTY_BOX = '☐';

/** A ticked skill. */
const TICK = '✓';

/** One row in the picker. */
export interface PickOption {
  /** The value returned when this row is ticked. */
  readonly value: string;
  /** The text shown in the list. */
  readonly label: string;
}

/**
 * Render one row. An unticked skill shows an empty box; a ticked one shows a
 * green tick, so the selection reads at a glance even without color.
 */
function renderOption(label: string, ticked: boolean, focused: boolean): string {
  if (ticked) {
    const mark = styleText('green', TICK);
    return focused ? `${mark} ${label}` : `${mark} ${styleText('dim', label)}`;
  }
  const mark = styleText('dim', EMPTY_BOX);
  return focused ? `${mark} ${label}` : `${mark} ${styleText('dim', label)}`;
}

/**
 * Show a checkbox list and return the values the user left ticked.
 *
 * This builds on clack's `MultiSelectPrompt` for the keyboard handling — space
 * toggles, enter confirms — and draws the list itself, because clack's own
 * multiselect hardcodes its checkbox symbols.
 *
 * Returns null when the prompt was cancelled.
 */
export async function pickSkills(
  message: string,
  options: readonly PickOption[],
  initialValues: readonly string[]
): Promise<string[] | null> {
  const prompt = new MultiSelectPrompt({
    options,
    initialValues,
    required: false,
    render() {
      const withGuide = settings.withGuide;
      const title = wrapTextWithPrefix(
        process.stdout,
        message,
        withGuide ? `${symbolBar(this.state)}  ` : '',
        `${symbol(this.state)}  `
      );
      const header = `${withGuide ? `${styleText('gray', S_BAR)}\n` : ''}${title}\n`;
      const ticked = this.value ?? [];

      if (this.state === 'submit') {
        const chosen =
          this.options
            .filter((option) => ticked.includes(option.value))
            .map((option) => option.label)
            .join(styleText('dim', ', ')) || styleText('dim', 'none');
        return `${header}${wrapTextWithPrefix(
          process.stdout,
          chosen,
          withGuide ? `${styleText('gray', S_BAR)}  ` : ''
        )}`;
      }

      if (this.state === 'cancel') {
        return `${header}${styleText('gray', S_BAR)}`;
      }

      if (this.state === 'error') {
        return `${header}${styleText('yellow', this.error)}`;
      }

      const bar = withGuide ? `${styleText('cyan', S_BAR)}  ` : '';
      const instructions = formatInstructionFooter(
        process.stdout,
        MULTISELECT_INSTRUCTIONS,
        withGuide
      );
      return `${header}${bar}${limitOptions({
        output: process.stdout,
        options: this.options,
        cursor: this.cursor,
        columnPadding: bar.length,
        rowPadding: header.split('\n').length + instructions.length + 1,
        style: (option, focused) =>
          renderOption(option.label, ticked.includes(option.value), focused),
      }).join(`\n${bar}`)}\n${instructions.join('\n')}\n`;
    },
  });

  const result = await prompt.prompt();
  if (isCancel(result)) return null;
  return result ?? [];
}
