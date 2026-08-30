import type { Product } from "./product.ts";
import { ProductCsv } from "./product_csv.ts";

/**
 * One department's products, appended to a CSV a spreadsheet can open and to
 * JSON lines that keep every field whole. Reopening reads back what earlier
 * runs captured, so an interrupted walk resumes rather than fetching the same
 * pages again.
 */
export class CatalogStore {
  private constructor(
    readonly path: string,
    readonly csvPath: string,
    private readonly asins: Set<string>,
  ) {}

  static async open(dir: string, name: string): Promise<CatalogStore> {
    await Deno.mkdir(dir, { recursive: true });
    const path = `${dir}/${name}.jsonl`;
    const csvPath = `${dir}/${name}.csv`;
    await CatalogStore.head(csvPath);
    return new CatalogStore(
      path,
      csvPath,
      await CatalogStore.capturedAsins(path),
    );
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
    await Deno.writeTextFile(this.csvPath, ProductCsv.row(product), {
      append: true,
    });
    this.asins.add(product.asin);
  }

  /** Names the columns once, when the CSV is first created. */
  private static async head(path: string): Promise<void> {
    const written = await Deno.stat(path).then((file) => file.size > 0).catch(
      () => false,
    );
    if (!written) await Deno.writeTextFile(path, ProductCsv.header());
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
