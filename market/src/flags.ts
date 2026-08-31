/**
 * The flags a command was given: `--name=value`, or `--name` on its own where
 * the flag is the whole of what it says. A flag the command has no use for is
 * refused by name, before a browser is launched — the same bargain the
 * sections of config.toml make with their settings.
 */
export class Flags {
  private readonly values = new Map<string, string>();

  constructor(
    args: readonly string[],
    /** The command they were given to, so a refusal says which one. */
    command: string,
    known: readonly string[],
  ) {
    for (const arg of args) {
      const separator = arg.indexOf("=");
      const flag = separator === -1 ? arg : arg.slice(0, separator);
      const name = flag.replace(/^--/, "");
      if (flag === name || !known.includes(name)) {
        throw new Error(
          `Unknown ${command} option: ${arg}. Try ${
            list(known.map((known) => `--${known}`))
          }.`,
        );
      }
      // A flag given twice reads as the last of them, as a shell's own do.
      this.values.set(name, separator === -1 ? "" : arg.slice(separator + 1));
    }
  }

  /** Whether the flag was given at all; what a flag with no value says. */
  given(name: string): boolean {
    return this.values.has(name);
  }

  /** What the flag was given, or nothing where it was not given at all. */
  text(name: string): string | undefined {
    const value = this.values.get(name);
    if (value === undefined) return undefined;
    if (value.trim() === "") throw new Error(`--${name} takes a value.`);
    return value.trim();
  }

  /** The comma-separated names a flag lists. */
  words(name: string): string[] | undefined {
    return this.text(name)?.split(",");
  }

  /** A whole number of at least the minimum, and nothing else. */
  count(name: string, minimum: number): number | undefined {
    const value = this.values.get(name);
    if (value === undefined) return undefined;

    const parsed = Number(value);
    if (value.trim() === "" || !Number.isInteger(parsed) || parsed < minimum) {
      throw new Error(`--${name} takes a whole number of at least ${minimum}.`);
    }
    return parsed;
  }
}

/** "a, b, or c" — the flags a command knows, as a sentence names them. */
function list(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}
