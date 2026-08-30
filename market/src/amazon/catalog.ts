import { CatalogDb } from "./catalog_db.ts";
import { CsvExport } from "./csv_export.ts";
import type { ImageStore } from "./image_store.ts";
import type { Product } from "./product.ts";

/**
 * Everything a walk writes: the database it is kept in, the preview images
 * saved beside it, and the CSV a spreadsheet opens. Saving a product does all
 * three, so the export never lags what the catalog holds.
 */
export class Catalog {
  private constructor(
    readonly path: string,
    private readonly db: CatalogDb,
    private readonly images: ImageStore,
    private readonly csv: CsvExport,
  ) {}

  static async open(dir: string, images: ImageStore): Promise<Catalog> {
    await Deno.mkdir(dir, { recursive: true });
    const path = `${dir}/catalog.db`;
    return new Catalog(
      path,
      CatalogDb.open(path),
      images,
      await CsvExport.open(dir),
    );
  }

  has(asin: string): boolean {
    return this.db.has(asin);
  }

  count(department: string): number {
    return this.db.count(department);
  }

  async save(product: Product): Promise<void> {
    const images = await this.images.save(product.asin, product.images);
    this.db.save(product, images);
    await this.csv.append(product, images);
  }

  /** Squares the CSV with the database, then closes it. */
  async close(): Promise<void> {
    try {
      await this.csv.rewrite(this.db);
    } finally {
      this.db.close();
    }
  }
}
