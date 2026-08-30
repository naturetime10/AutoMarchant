import type { Page } from "playwright";

/**
 * What a failing page looked like, written for after the fact. A run writes
 * one: whatever stopped it stops it the same way on every tab, and the first
 * page to be given up on is the one that says why.
 */
export class Diagnostics {
  private written = false;

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
    private readonly say: (line: string) => void = console.error,
  ) {}

  /** Writes the page as a screenshot beside its HTML; the first page only. */
  async save(page: Page): Promise<void> {
    if (this.written) return;
    this.written = true;

    try {
      await Deno.mkdir(this.dir, { recursive: true });
      const stem = `${this.dir}/${
        this.now().toISOString().replaceAll(":", "-")
      }`;
      await page.screenshot({ path: `${stem}.png`, fullPage: true });
      await Deno.writeTextFile(`${stem}.html`, await page.content());
      this.say(`Wrote ${stem}.{png,html} of ${page.url()}`);
    } catch (error) {
      this.say(`Could not write diagnostics: ${error}`);
    }
  }
}
