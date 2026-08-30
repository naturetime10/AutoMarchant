/**
 * A run's progress, on the terminal and in a log file. The file is appended
 * to, so the record of what a walk covered survives the runs after it.
 */
export class RunLog {
  private constructor(
    readonly path: string,
    private readonly echo: (line: string) => void,
    private readonly now: () => Date,
  ) {}

  static async open(
    dir: string,
    name = "discover.log",
    echo: (line: string) => void = console.log,
    now: () => Date = () => new Date(),
  ): Promise<RunLog> {
    await Deno.mkdir(dir, { recursive: true });
    return new RunLog(`${dir}/${name}`, echo, now);
  }

  info(message: string): Promise<void> {
    return this.write(message);
  }

  error(message: string): Promise<void> {
    return this.write(`ERROR ${message}`);
  }

  /** The terminal gets the message; the file gets it stamped with the time. */
  private async write(message: string): Promise<void> {
    this.echo(message);
    await Deno.writeTextFile(
      this.path,
      `${this.now().toISOString()} ${message}\n`,
      { append: true },
    );
  }
}
