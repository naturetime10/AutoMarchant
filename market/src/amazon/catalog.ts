import { Mutex } from "../concurrency.ts";
import { CatalogDb } from "./catalog_db.ts";
import type { ImageStore } from "./image_store.ts";
import type { Product } from "./product.ts";

/**
 * Everything a walk writes: the database it is kept in and the preview images
 * saved beside it. Saving a product does both, so the images never lag what
 * the catalog holds.
 *
 * One database connection serves however many tabs a walk reads with, so
 * writing to it is one product at a time.
 */
export class Catalog {
  private readonly turns = new Mutex();

  private constructor(
    /** The database this walk writes to, with any password left out. */
    readonly label: string,
    private readonly db: CatalogDb,
    private readonly images: ImageStore,
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
    await this.turns.run(() => this.db.save(product, images));
  }

  close(): Promise<void> {
    return this.turns.run(() => this.db.close());
  }
}

/** A connection string safe to print in a log. */
function withoutPassword(databaseUrl: string): string {
  const parsed = URL.parse(databaseUrl);
  if (!parsed?.password) return databaseUrl;
  parsed.password = "";
  return parsed.href;
}
