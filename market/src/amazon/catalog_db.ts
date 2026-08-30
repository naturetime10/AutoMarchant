import { Client, type ClientOptions, Oid } from "@db/postgres";
import type { StoredImage } from "./image_store.ts";
import { parseDate } from "./parse.ts";
import { type Product, readByline } from "./product.ts";

/**
 * A product has a shape of its own: many reviews, many detail rows, many
 * images. Each of those gets a table keyed back to the ASIN, so a rerun
 * replaces a product rather than appending a second copy of it, and what a
 * walk found can be asked questions of in SQL.
 */
const SCHEMA = `
  -- A department's trail is a tree, not a sentence: "Kitchen & Dining" is one
  -- node that many trails pass through. Each node is a row naming the parent
  -- it hangs from, so a branch two trails share is stored once, and what sits
  -- beneath a node is a walk down parent_id rather than a match on a string.
  CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );
  -- A name is unique among its siblings, and the roots are siblings of one
  -- another: NULLS NOT DISTINCT is what makes a second "Home & Kitchen" at the
  -- top collide with the first rather than sit beside it. It indexes
  -- parent_id first, so it is also how the tree is walked downward.
  CREATE UNIQUE INDEX IF NOT EXISTS categories_trail
    ON categories (parent_id, name) NULLS NOT DISTINCT;

  CREATE TABLE IF NOT EXISTS products (
    asin TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    department TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    title TEXT,
    brand TEXT,
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
    author TEXT,
    category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL
  );
  -- Books were walked before their byline was understood, so a catalog that
  -- predates the column is given it here rather than being started again.
  ALTER TABLE products ADD COLUMN IF NOT EXISTS author TEXT;
  -- Likewise a catalog whose trails are still folded into a cell; the cell is
  -- read into the tree, and then dropped, by adoptBreadcrumbTrees.
  ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER
    REFERENCES categories (id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS products_department ON products (department);
  CREATE INDEX IF NOT EXISTS products_category ON products (category_id);

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
    date TIMESTAMPTZ,
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

  -- A fashion carousel was read into styling_ideas before a fashion page had
  -- ever been walked, and no product ever filled it. The guess is dropped
  -- rather than carried: a walk of Clothing can say what those carousels hold.
  DROP TABLE IF EXISTS styling_ideas;

  -- Where a walk of a department stopped, so the next one opens the page it
  -- was on rather than reading its way back down from the top. A department
  -- walked end to end keeps no row: its next walk starts at the listings'
  -- first page, which is where what has newly been ranked appears.
  CREATE TABLE IF NOT EXISTS walks (
    department TEXT PRIMARY KEY,
    next_page INTEGER NOT NULL
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
  categories: ["id", "parent_id", "name"],
  products: [
    "asin",
    "url",
    "department",
    "captured_at",
    "title",
    "brand",
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
    "category_id",
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
  captures: [
    "asin",
    "captured_at",
    "price",
    "list_price",
    "rating_average",
    "rating_count",
    "availability",
  ],
  walks: ["department", "next_page"],
} as const;

export type TableName = keyof typeof TABLES;

/** The tables a product owns, cleared before it is written again. */
const OWNED: TableName[] = [
  "attributes",
  "features",
  "images",
  "reviews",
  "questions",
];

/** The catalog a walk fills in, as a Postgres database. */
export class CatalogDb {
  private constructor(private readonly client: Client) {}

  static async open(url: string): Promise<CatalogDb> {
    const client = new Client(connection(url));
    await client.connect();
    await client.queryArray(SCHEMA);
    const db = new CatalogDb(client);
    await db.adoptBreadcrumbTrees();
    await db.adoptBookAuthors();
    await db.adoptReviewDates();
    return db;
  }

  /**
   * A trail used to be folded into one cell, which made "everything under
   * Kitchen & Dining" a string match rather than a question about a tree. The
   * cell still names the trail, so it is read into `categories` here and then
   * dropped — the trail it held is kept, in the shape it always had.
   */
  private async adoptBreadcrumbTrees(): Promise<void> {
    if (!await this.hasBreadcrumbs()) return;

    const { rows } = await this.client.queryArray<[string, string]>(
      `SELECT asin, breadcrumbs FROM products WHERE breadcrumbs <> ''`,
    );

    for (const [asin, trail] of rows) {
      await this.client.queryArray(
        "UPDATE products SET category_id = $1 WHERE asin = $2",
        [await this.categoryFor(trail.split(" > ")), asin],
      );
    }

    await this.client.queryArray(
      "ALTER TABLE products DROP COLUMN breadcrumbs",
    );
  }

  private async hasBreadcrumbs(): Promise<boolean> {
    const { rows } = await this.client.queryArray<[boolean]>(
      `SELECT count(*) > 0 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'products'
         AND column_name = 'breadcrumbs'`,
    );
    return rows[0][0];
  }

  /**
   * The trail as a chain of rows, made where it does not reach yet, answered
   * with the leaf a product is filed under. A branch two trails share resolves
   * to the row that is already there, which is what keeps the tree a tree.
   */
  private async categoryFor(trail: string[]): Promise<number | null> {
    let parent: number | null = null;

    for (const name of trail.filter((name) => name !== "")) {
      parent = await this.node(parent, name);
    }

    return parent;
  }

  /** One level of a trail: the row that is there, or the row it becomes. */
  private async node(parent: number | null, name: string): Promise<number> {
    // The upsert has to update something for RETURNING to answer with a row
    // that was already there, so it writes back the name it just read.
    const { rows } = await this.client.queryArray<[number]>(
      `INSERT INTO categories (parent_id, name) VALUES ($1, $2)
       ON CONFLICT (parent_id, name) DO UPDATE SET name = excluded.name
       RETURNING id`,
      [parent, name],
    );
    return rows[0][0];
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

  /**
   * A review's date used to be kept as the words the page dated it in, which
   * left "reviews since June" a string match rather than a comparison. The
   * words still name a day, so they are read the way a fresh walk reads them —
   * one pass per wording, since a catalog holds far more reviews than days —
   * and the column becomes the moments they meant.
   */
  private async adoptReviewDates(): Promise<void> {
    if (!await this.hasWordedReviewDates()) return;

    const { rows } = await this.client.queryArray<[string]>(
      "SELECT DISTINCT date FROM reviews WHERE date IS NOT NULL",
    );

    for (const [words] of rows) {
      await this.client.queryArray(
        "UPDATE reviews SET date = $1 WHERE date = $2",
        // A line that names no day is emptied: the cast below would otherwise
        // refuse the whole column over it.
        [parseDate(words) ?? null, words],
      );
    }

    await this.client.queryArray(
      `ALTER TABLE reviews ALTER COLUMN date TYPE TIMESTAMPTZ
        USING date::timestamptz`,
    );
  }

  private async hasWordedReviewDates(): Promise<boolean> {
    const { rows } = await this.client.queryArray<[boolean]>(
      `SELECT count(*) > 0 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'reviews'
         AND column_name = 'date' AND data_type = 'text'`,
    );
    return rows[0][0];
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

  /** The listing page a walk of this department should open next. */
  async nextPage(department: string): Promise<number> {
    const { rows } = await this.client.queryArray<[number]>(
      "SELECT next_page FROM walks WHERE department = $1",
      [department],
    );
    return rows[0]?.[0] ?? 1;
  }

  /** Keeps the page a walk of this department is to be picked up at. */
  async keepPlace(department: string, page: number): Promise<void> {
    await this.client.queryArray(
      `INSERT INTO walks (department, next_page) VALUES ($1, $2)
       ON CONFLICT (department) DO UPDATE SET next_page = excluded.next_page`,
      [department, page],
    );
  }

  /** Drops the place kept for a department, sending its next walk to page 1. */
  async forgetPlace(department: string): Promise<void> {
    await this.client.queryArray(
      "DELETE FROM walks WHERE department = $1",
      [department],
    );
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
    const category = await this.categoryFor(product.breadcrumbs);

    await this.client.queryArray(
      `INSERT INTO products (${TABLES.products.join(", ")})
       VALUES (${placeholders(TABLES.products.length)})
       ON CONFLICT (asin) DO UPDATE SET ${
        TABLES.products.filter((column) => column !== "asin")
          .map((column) => `${column} = excluded.${column}`).join(", ")
      }`,
      productRow(product, category),
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

function productRow(product: Product, category: number | null): unknown[] {
  return [
    product.asin,
    product.url,
    product.department,
    product.capturedAt,
    product.title ?? null,
    product.brand ?? null,
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
    category,
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
