import { csvLine } from "../csv.ts";
import { type CatalogDb, type TableName, TABLES } from "./catalog_db.ts";
import type { StoredImage } from "./image_store.ts";
import type { Product } from "./product.ts";

/**
 * The catalog as CSV, a file per table. Rows are appended as each product is
 * read, so a walk in progress can be watched; the files are rewritten from
 * the database when the walk ends, so what they hold matches it exactly even
 * after a refresh has revisited products they already listed.
 */
export class CsvExport {
  private constructor(private readonly dir: string) {}

  static async open(dir: string): Promise<CsvExport> {
    await Deno.mkdir(dir, { recursive: true });
    for (const table of Object.keys(TABLES) as TableName[]) {
      await head(`${dir}/${table}.csv`, header(table));
    }
    return new CsvExport(dir);
  }

  async append(product: Product, images: StoredImage[]): Promise<void> {
    const asin = product.asin;

    await this.write("products", [[
      asin,
      product.url,
      product.department,
      product.capturedAt,
      product.title,
      product.brand,
      product.breadcrumbs.join(" > "),
      product.price?.amount,
      product.listPrice?.amount,
      product.price?.currency ?? product.listPrice?.currency,
      product.rating.average,
      product.rating.count,
      product.answeredQuestions,
      product.availability,
      product.store.name,
      product.store.url,
      product.store.soldBy,
      product.store.shipsFrom,
      product.store.sellerUrl,
      product.style,
      product.description,
      product.aplus,
    ]]);

    await this.write(
      "attributes",
      [
        ...kind(product.details, "detail"),
        ...kind(product.variations, "variation"),
        ...kind(product.measurements, "measurement"),
      ].map(([label, key, value]) => [asin, label, key, value]),
    );

    await this.write(
      "features",
      product.features.map((feature, index) => [asin, index + 1, feature]),
    );

    await this.write(
      "images",
      images.map((image, index) => [asin, index + 1, image.url, image.path]),
    );

    await this.write(
      "reviews",
      product.reviews.map((review, index) => [
        asin,
        index + 1,
        review.title,
        review.author,
        review.rating,
        review.date,
        review.verifiedPurchase,
        review.body,
        review.helpfulVotes,
      ]),
    );

    await this.write(
      "questions",
      product.questions.map((question, index) => [
        asin,
        index + 1,
        question.question,
        question.answer,
        question.votes,
      ]),
    );

    await this.write(
      "styling_ideas",
      product.stylingIdeas.map((idea, index) => [asin, index + 1, idea]),
    );

    await this.write("captures", [[
      asin,
      product.capturedAt,
      product.price?.amount,
      product.listPrice?.amount,
      product.rating.average,
      product.rating.count,
      product.availability,
    ]]);
  }

  /** Replaces every file with what the database now holds. */
  async rewrite(db: CatalogDb): Promise<void> {
    for (const table of Object.keys(TABLES) as TableName[]) {
      await Deno.writeTextFile(
        `${this.dir}/${table}.csv`,
        header(table) + db.rows(table).map(csvLine).join(""),
      );
    }
  }

  private async write(table: TableName, rows: unknown[][]): Promise<void> {
    if (rows.length === 0) return;
    await Deno.writeTextFile(
      `${this.dir}/${table}.csv`,
      rows.map(csvLine).join(""),
      { append: true },
    );
  }
}

function header(table: TableName): string {
  return csvLine([...TABLES[table]]);
}

function kind(
  values: Record<string, string>,
  label: string,
): Array<[string, string, string]> {
  return Object.entries(values).map(([key, value]) => [label, key, value]);
}

/** Names the columns once, when the file is first created. */
async function head(path: string, columns: string): Promise<void> {
  const written = await Deno.stat(path).then((file) => file.size > 0).catch(
    () => false,
  );
  if (!written) await Deno.writeTextFile(path, columns);
}
