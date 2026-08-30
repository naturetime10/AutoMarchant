import { Mutex } from "../concurrency.ts";
import { CatalogDb } from "./catalog_db.ts";
import { CsvExport } from "./csv_export.ts";
import type { ImageStore } from "./image_store.ts";
import type { Product } from "./product.ts";

/**
 * Everything a walk writes: the database it is kept in, the preview images
 * saved beside it, and the CSV a spreadsheet opens. Saving a product does all
 * three, so the export never lags what the catalog holds.
 *
 * One database connection and one set of CSV files serve however many tabs a
 * walk reads with, so writing to them is one product at a time.
 */
export class Catalog {
  private readonly turns = new Mutex();

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
    return this.turns.run(() => this.db.has(asin));
  }

  count(department: string): Promise<number> {
    return this.turns.run(() => this.db.count(department));
  }

  /** The images come off the network first, before a turn is taken. */
  async save(product: Product): Promise<void> {
    const images = await this.images.save(product.asin, product.images);
    await this.turns.run(async () => {
      await this.db.save(product, images);
      await this.csv.append(product, images);
    });
  }

  /** Squares the CSV with the database, then closes it. */
  close(): Promise<void> {
    return this.turns.run(async () => {
      try {
        await this.csv.rewrite(this.db);
      } finally {
        await this.db.close();
      }
    });
  }
}

/** A connection string safe to print in a log. */
function withoutPassword(databaseUrl: string): string {
  const parsed = URL.parse(databaseUrl);
  if (!parsed?.password) return databaseUrl;
  parsed.password = "";
  return parsed.href;
}
