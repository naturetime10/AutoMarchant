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
    /** The database this walk writes to, with any password left out. */
    readonly label: string,
    private readonly db: CatalogDb,
    private readonly images: ImageStore,
    private readonly csv: CsvExport,
  ) {}

  static async open(
    dir: string,
    databaseUrl: string,
    images: ImageStore,
  ): Promise<Catalog> {
    await Deno.mkdir(dir, { recursive: true });
    return new Catalog(
      withoutPassword(databaseUrl),
      await CatalogDb.open(databaseUrl),
      images,
      await CsvExport.open(dir),
    );
  }

  has(asin: string): Promise<boolean> {
    return this.db.has(asin);
  }

  count(department: string): Promise<number> {
    return this.db.count(department);
  }

  async save(product: Product): Promise<void> {
    const images = await this.images.save(product.asin, product.images);
    await this.db.save(product, images);
    await this.csv.append(product, images);
  }

  /** Squares the CSV with the database, then closes it. */
  async close(): Promise<void> {
    try {
      await this.csv.rewrite(this.db);
    } finally {
      await this.db.close();
    }
  }
}

/** A connection string safe to print in a log. */
function withoutPassword(databaseUrl: string): string {
  const parsed = URL.parse(databaseUrl);
  if (!parsed?.password) return databaseUrl;
  parsed.password = "";
  return parsed.href;
}
