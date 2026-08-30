import { Client, type ClientOptions, Oid } from "@db/postgres";
import type { StoredImage } from "./image_store.ts";
import { type Product, readByline } from "./product.ts";

/**
 * A product has a shape of its own: many reviews, many detail rows, many
 * images. Each of those gets a table keyed back to the ASIN, so a rerun
 * replaces a product rather than appending a second copy of it, and what a
 * walk found can be asked questions of in SQL.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    asin TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    department TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    title TEXT,
    brand TEXT,
    breadcrumbs TEXT,
    price DOUBLE PRECISION,
    list_price DOUBLE PRECISION,
    currency TEXT,
    rating_average DOUBLE PRECISION,
    rating_count INTEGER,
    answered_questions INTEGER,
    availability TEXT,
    store_name TEXT,
    store_url TEXT,
    sold_by TEXT,
    ships_from TEXT,
    seller_url TEXT,
    style TEXT,
    description TEXT,
    aplus TEXT,
    author TEXT
  );
  -- Books were walked before their byline was understood, so a catalog that
  -- predates the column is given it here rather than being started again.
  ALTER TABLE products ADD COLUMN IF NOT EXISTS author TEXT;
  CREATE INDEX IF NOT EXISTS products_department ON products (department);

  CREATE TABLE IF NOT EXISTS attributes (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (asin, kind, key)
  );

  CREATE TABLE IF NOT EXISTS features (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    feature TEXT NOT NULL,
    PRIMARY KEY (asin, position)
  );

  CREATE TABLE IF NOT EXISTS images (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    url TEXT NOT NULL,
    path TEXT,
    PRIMARY KEY (asin, position)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT,
    author TEXT,
    rating DOUBLE PRECISION,
    date TEXT,
    verified_purchase BOOLEAN NOT NULL,
    body TEXT,
    helpful_votes INTEGER,
    PRIMARY KEY (asin, position)
  );

  CREATE TABLE IF NOT EXISTS questions (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    votes INTEGER,
    PRIMARY KEY (asin, position)
  );

  CREATE TABLE IF NOT EXISTS styling_ideas (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    idea TEXT NOT NULL,
    PRIMARY KEY (asin, position)
  );

  CREATE TABLE IF NOT EXISTS captures (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    captured_at TIMESTAMPTZ NOT NULL,
    price DOUBLE PRECISION,
    list_price DOUBLE PRECISION,
    rating_average DOUBLE PRECISION,
    rating_count INTEGER,
    availability TEXT,
    PRIMARY KEY (asin, captured_at)
  );
`;

/** Every table and its columns, in order. */
export const TABLES = {
  products: [
    "asin",
    "url",
    "department",
    "captured_at",
    "title",
    "brand",
    "breadcrumbs",
    "price",
    "list_price",
    "currency",
    "rating_average",
    "rating_count",
    "answered_questions",
    "availability",
    "store_name",
    "store_url",
    "sold_by",
    "ships_from",
    "seller_url",
    "style",
    "description",
    "aplus",
    "author",
  ],
  attributes: ["asin", "kind", "key", "value"],
  features: ["asin", "position", "feature"],
  images: ["asin", "position", "url", "path"],
  reviews: [
    "asin",
    "position",
    "title",
    "author",
    "rating",
    "date",
    "verified_purchase",
    "body",
    "helpful_votes",
  ],
  questions: ["asin", "position", "question", "answer", "votes"],
  styling_ideas: ["asin", "position", "idea"],
  captures: [
    "asin",
    "captured_at",
    "price",
    "list_price",
    "rating_average",
    "rating_count",
    "availability",
  ],
} as const;

export type TableName = keyof typeof TABLES;

/** The tables a product owns, cleared before it is written again. */
const OWNED: TableName[] = [
  "attributes",
  "features",
  "images",
  "reviews",
  "questions",
  "styling_ideas",
];

/** The catalog a walk fills in, as a Postgres database. */
export class CatalogDb {
  private constructor(private readonly client: Client) {}

  static async open(url: string): Promise<CatalogDb> {
    const client = new Client(connection(url));
    await client.connect();
    await client.queryArray(SCHEMA);
    const db = new CatalogDb(client);
    await db.adoptBookAuthors();
    return db;
  }

  /**
   * A book's byline names its author, but an earlier walk filed it as the
   * brand and the storefront. The byline it wrote still says who wrote the
   * book, so it is read again here and the rows it misfiled are emptied —
   * cheaper, and truer to when it was read, than walking the pages again.
   */
  private async adoptBookAuthors(): Promise<void> {
    const { rows } = await this.client.queryArray<[string, string]>(
      `SELECT asin, coalesce(store_name, brand) FROM products
       WHERE author IS NULL
         AND coalesce(store_name, brand) ~* '^by |\\(author\\)'`,
    );

    for (const [asin, byline] of rows) {
      const { author } = readByline(byline);
      if (!author) continue;
      await this.client.queryArray(
        `UPDATE products
         SET author = $1, brand = NULL, store_name = NULL, store_url = NULL
         WHERE asin = $2`,
        [author, asin],
      );
    }
  }

  async has(asin: string): Promise<boolean> {
    const { rows } = await this.client.queryArray(
      "SELECT 1 FROM products WHERE asin = $1",
      [asin],
    );
    return rows.length > 0;
  }

  async count(department: string): Promise<number> {
    const { rows } = await this.client.queryArray<[number]>(
      "SELECT count(*)::int FROM products WHERE department = $1",
      [department],
    );
    return rows[0][0];
  }

  /** Writes a product and everything it owns, as one all-or-nothing step. */
  async save(product: Product, images: StoredImage[]): Promise<void> {
    await this.client.queryArray("BEGIN");
    try {
      await this.write(product, images);
      await this.client.queryArray("COMMIT");
    } catch (error) {
      await this.client.queryArray("ROLLBACK");
      throw error;
    }
  }

  close(): Promise<void> {
    return this.client.end();
  }

  private async write(product: Product, images: StoredImage[]): Promise<void> {
    const asin = product.asin;

    await this.client.queryArray(
      `INSERT INTO products (${TABLES.products.join(", ")})
       VALUES (${placeholders(TABLES.products.length)})
       ON CONFLICT (asin) DO UPDATE SET ${
        TABLES.products.filter((column) => column !== "asin")
          .map((column) => `${column} = excluded.${column}`).join(", ")
      }`,
      productRow(product),
    );

    for (const table of OWNED) {
      await this.client.queryArray(`DELETE FROM ${table} WHERE asin = $1`, [
        asin,
      ]);
    }

    await this.insert(
      "attributes",
      [
        ...kind(product.details, "detail"),
        ...kind(product.variations, "variation"),
        ...kind(product.measurements, "measurement"),
      ].map(([label, key, value]) => [asin, label, key, value]),
    );

    await this.insert(
      "features",
      product.features.map((feature, index) => [asin, index + 1, feature]),
    );

    await this.insert(
      "images",
      images.map((image, index) => [
        asin,
        index + 1,
        image.url,
        image.path ?? null,
      ]),
    );

    await this.insert(
      "reviews",
      product.reviews.map((review, index) => [
        asin,
        index + 1,
        review.title ?? null,
        review.author ?? null,
        review.rating ?? null,
        review.date ?? null,
        review.verifiedPurchase,
        review.body ?? null,
        review.helpfulVotes ?? null,
      ]),
    );

    await this.insert(
      "questions",
      product.questions.map((question, index) => [
        asin,
        index + 1,
        question.question,
        question.answer ?? null,
        question.votes ?? null,
      ]),
    );

    await this.insert(
      "styling_ideas",
      product.stylingIdeas.map((idea, index) => [asin, index + 1, idea]),
    );

    // A product read twice keeps both readings, which is the price series.
    await this.client.queryArray(
      `INSERT INTO captures (${TABLES.captures.join(", ")})
       VALUES (${placeholders(TABLES.captures.length)})
       ON CONFLICT (asin, captured_at) DO NOTHING`,
      [
        asin,
        product.capturedAt,
        product.price?.amount ?? null,
        product.listPrice?.amount ?? null,
        product.rating.average ?? null,
        product.rating.count ?? null,
        product.availability ?? null,
      ],
    );
  }

  /** One statement per table, however many rows it carries. */
  private async insert(table: TableName, rows: unknown[][]): Promise<void> {
    if (rows.length === 0) return;

    const width = TABLES[table].length;
    const tuples = rows.map((_, row) => `(${placeholders(width, row * width)})`)
      .join(", ");

    await this.client.queryArray(
      `INSERT INTO ${table} (${TABLES[table].join(", ")}) VALUES ${tuples}`,
      rows.flat(),
    );
  }
}

/**
 * The driver reads a connection string, but only the object form carries the
 * decoders — and it leaves float8 as text, which would turn every price and
 * rating into a string on the way back out.
 */
export function connection(databaseUrl: string): ClientOptions {
  const url = new URL(databaseUrl);
  return {
    hostname: url.hostname,
    port: Number(url.port) || 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password) || undefined,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    controls: { decoders: { [Oid.float8]: (value: string) => Number(value) } },
  };
}

function productRow(product: Product): unknown[] {
  return [
    product.asin,
    product.url,
    product.department,
    product.capturedAt,
    product.title ?? null,
    product.brand ?? null,
    product.breadcrumbs.join(" > ") || null,
    product.price?.amount ?? null,
    product.listPrice?.amount ?? null,
    product.price?.currency ?? product.listPrice?.currency ?? null,
    product.rating.average ?? null,
    product.rating.count ?? null,
    product.answeredQuestions ?? null,
    product.availability ?? null,
    product.store.name ?? null,
    product.store.url ?? null,
    product.store.soldBy ?? null,
    product.store.shipsFrom ?? null,
    product.store.sellerUrl ?? null,
    product.style ?? null,
    product.description ?? null,
    product.aplus ?? null,
    product.author ?? null,
  ];
}

function placeholders(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, i) => `$${offset + i + 1}`).join(
    ", ",
  );
}

function kind(
  values: Record<string, string>,
  label: string,
): Array<[string, string, string]> {
  return Object.entries(values).map(([key, value]) => [label, key, value]);
}
