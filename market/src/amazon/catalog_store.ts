import type { Product } from "./product.ts";

/**
 * One department's products, appended as JSON lines. Reopening the file reads
 * back what earlier runs captured, so an interrupted walk resumes rather than
 * fetching the same pages again.
 */
export class CatalogStore {
  private constructor(
    readonly path: string,
    private readonly asins: Set<string>,
  ) {}

  static async open(dir: string, name: string): Promise<CatalogStore> {
    await Deno.mkdir(dir, { recursive: true });
    const path = `${dir}/${name}.jsonl`;
    return new CatalogStore(path, await CatalogStore.capturedAsins(path));
  }

  get size(): number {
    return this.asins.size;
  }

  has(asin: string): boolean {
    return this.asins.has(asin);
  }

  async append(product: Product): Promise<void> {
    await Deno.writeTextFile(this.path, `${JSON.stringify(product)}\n`, {
      append: true,
    });
    this.asins.add(product.asin);
  }

  private static async capturedAsins(path: string): Promise<Set<string>> {
    const asins = new Set<string>();

    let contents: string;
    try {
      contents = await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return asins;
      throw error;
    }

    for (const line of contents.split("\n")) {
      if (!line.trim()) continue;
      try {
        const { asin } = JSON.parse(line) as { asin?: string };
        if (asin) asins.add(asin);
      } catch {
        // A run killed mid-write leaves a partial last line; skip it.
      }
    }
    return asins;
  }
}
