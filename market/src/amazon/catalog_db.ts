import { Client, type ClientOptions, Oid } from "@db/postgres";
import type { Finding } from "./audit.ts";
import type { StoredImage } from "./image_store.ts";
import { parseDate } from "./parse.ts";
import { type Category, type Product, readByline } from "./product.ts";

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
  -- Amazon's own id for the category, where the link it was read from named
  -- one. It is the surer identity of the two: the same category is written
  -- differently in different places — "Breeds" at the end of a trail, "Cat
  -- Breeds (Books)" in a rank — and the node is what says they are one. A
  -- catalog written before the node was read has none, and picks them up as
  -- its products are read again.
  ALTER TABLE categories ADD COLUMN IF NOT EXISTS node TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS categories_node
    ON categories (node) WHERE node IS NOT NULL;
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
  CREATE INDEX IF NOT EXISTS products_department ON products (department);

  -- A product sits in more than one category: its trail draws one, and its
  -- Best Sellers Rank names the others — sometimes the trail's own leaf under
  -- another name, sometimes a category the trail never passes through. So the
  -- categories a product is filed under are a table rather than a column, and
  -- the column an earlier catalog kept is folded into it by adoptCategoryColumn.
  CREATE TABLE IF NOT EXISTS product_categories (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    PRIMARY KEY (asin, category_id)
  );
  -- Everything under a category is a walk down the tree and then this index.
  CREATE INDEX IF NOT EXISTS product_categories_category
    ON product_categories (category_id);

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

  -- What a department's listings ranked, page by page: the queue a walk works
  -- through. A product joins it the moment a listing names it and leaves it
  -- once it has been read, so a walk cut short resumes on the products it saw
  -- and never got to — wherever Amazon has re-ranked them to since, or
  -- whether it still ranks them at all.
  CREATE TABLE IF NOT EXISTS listings (
    department TEXT NOT NULL,
    asin TEXT NOT NULL,
    page INTEGER NOT NULL,
    position INTEGER NOT NULL,
    -- Reads that came back with nothing. A product page that will not load is
    -- asked for again by the next walk, but not by every walk thereafter.
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (department, asin)
  );
  -- The queue is read in the order the listings ranked it.
  CREATE INDEX IF NOT EXISTS listings_rank
    ON listings (department, page, position);

  -- How far a department's listings have been read into the queue, so the
  -- next walk lists the page after rather than paging its way back down from
  -- the top. A department listed end to end keeps no row: its next walk
  -- starts at the first page, which is where what has newly been ranked
  -- appears.
  CREATE TABLE IF NOT EXISTS walks (
    department TEXT PRIMARY KEY,
    next_page INTEGER NOT NULL
  );

  -- What an audit made of a record: whether it still reads the way the page
  -- behind it does. One row per product rather than a history of them — the
  -- question an audit answers is which records are wrong now — and the row
  -- goes when a walk writes the product again, because a record that has just
  -- been read is one nobody has checked.
  CREATE TABLE IF NOT EXISTS audits (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    checked_at TIMESTAMPTZ NOT NULL,
    verdict TEXT NOT NULL,
    PRIMARY KEY (asin)
  );
  -- An audit takes the records it has been longest since checking first, and
  -- those it has never checked before them.
  CREATE INDEX IF NOT EXISTS audits_checked ON audits (checked_at);

  -- Where a record and its page disagreed: the column, what the catalog
  -- holds, and what the page says instead.
  CREATE TABLE IF NOT EXISTS audit_differences (
    asin TEXT NOT NULL REFERENCES audits (asin) ON DELETE CASCADE,
    field TEXT NOT NULL,
    stored TEXT,
    found TEXT,
    PRIMARY KEY (asin, field)
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
  categories: ["id", "parent_id", "name", "node"],
  product_categories: ["asin", "category_id"],
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
  listings: ["department", "asin", "page", "position", "attempts"],
  walks: ["department", "next_page"],
  audits: ["asin", "checked_at", "verdict"],
  audit_differences: ["asin", "field", "stored", "found"],
} as const;

export type TableName = keyof typeof TABLES;

/**
 * How often a product page is asked for, over as many walks, before the queue
 * leaves it alone. A page that will not load is usually a product Amazon has
 * taken down, and a walk that retries those first spends every run on them.
 */
const MAX_ATTEMPTS = 3;

/**
 * The tables a product owns, cleared before it is written again. The audit of
 * it goes with them: a record that has just been read is one no audit has
 * looked at, whatever an audit made of what it used to say.
 */
const OWNED: TableName[] = [
  "attributes",
  "features",
  "images",
  "reviews",
  "questions",
  "audits",
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
    await db.adoptCategoryColumn();
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
      let parent: number | null = null;
      for (const name of trail.split(" > ").filter((name) => name !== "")) {
        parent = await this.place(parent, { name });
      }
      if (parent !== null) await this.file(asin, [parent]);
    }

    await this.client.queryArray(
      "ALTER TABLE products DROP COLUMN breadcrumbs",
    );
  }

  /**
   * A product used to be filed under one category, in a column of its own.
   * It sits in several — its trail draws one and its rank names the rest — so
   * the column is read into `product_categories` here and then dropped; the
   * category it held is kept, as the first of however many the next read of
   * the product finds.
   */
  private async adoptCategoryColumn(): Promise<void> {
    if (!await this.hasColumn("products", "category_id")) return;

    await this.client.queryArray(
      `INSERT INTO product_categories (asin, category_id)
       SELECT asin, category_id FROM products WHERE category_id IS NOT NULL
       ON CONFLICT DO NOTHING`,
    );
    await this.client.queryArray(
      "ALTER TABLE products DROP COLUMN category_id",
    );
  }

  private hasBreadcrumbs(): Promise<boolean> {
    return this.hasColumn("products", "breadcrumbs");
  }

  private async hasColumn(table: string, column: string): Promise<boolean> {
    const { rows } = await this.client.queryArray<[boolean]>(
      `SELECT count(*) > 0 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
         AND column_name = $2`,
      [table, column],
    );
    return rows[0][0];
  }

  /**
   * Every category a product is filed under: the leaf of the trail Amazon
   * draws, and each category its rank names besides. A branch two trails
   * share resolves to the row that is already there, which is what keeps the
   * tree a tree.
   */
  private async categoriesFor(product: Product): Promise<number[]> {
    let parent: number | null = null;
    for (const category of product.breadcrumbs) {
      parent = await this.place(parent, category);
    }

    const filed = parent === null ? [] : [parent];
    for (const category of product.ranked) {
      // A rank names a category without saying where it hangs, so it goes in
      // as a node on its own until a trail passes through it. Where the node
      // is one the trail just walked, that is the row this finds — the
      // product is in the one category, however Amazon wrote it there.
      const id = await this.place(null, category);
      if (!filed.includes(id)) filed.push(id);
    }
    return filed;
  }

  /**
   * One category: the row that is there, or the row it becomes. The browse
   * node is the identity where the link named one, so a category met first in
   * a rank and later in a trail is the one row — and the trail is what tells
   * it where it hangs.
   */
  private async place(
    parent: number | null,
    category: Category,
  ): Promise<number> {
    if (category.node) {
      const { rows } = await this.client.queryArray<[number, number | null]>(
        "SELECT id, parent_id FROM categories WHERE node = $1",
        [category.node],
      );
      if (rows.length > 0) {
        const [id, hangsFrom] = rows[0];
        // A category first met in a rank hangs from nothing; a trail passing
        // through it now says where it belongs, and what it is called there.
        if (parent !== null && hangsFrom === null) {
          await this.client.queryArray(
            "UPDATE categories SET parent_id = $1, name = $2 WHERE id = $3",
            [parent, category.name, id],
          );
        }
        return id;
      }
    }

    // Not known by node, so the name among its siblings is what is left to go
    // on. The upsert has to update something for RETURNING to answer with a
    // row that was already there, so it writes back the node it now knows.
    const { rows } = await this.client.queryArray<[number]>(
      `INSERT INTO categories (parent_id, name, node) VALUES ($1, $2, $3)
       ON CONFLICT (parent_id, name) DO UPDATE
         SET node = COALESCE(categories.node, excluded.node)
       RETURNING id`,
      [parent, category.name, category.node ?? null],
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

  /** Queues what one listing page ranked, in the order it ranked them. */
  async listed(
    department: string,
    page: number,
    asins: readonly string[],
  ): Promise<void> {
    if (asins.length === 0) return;
    // A product the listings rank a second time keeps the row it already has,
    // and with it the reads that row has been given. A page that ranks one
    // twice — the tile Amazon sponsors it with, beside the tile it earned —
    // queues it at the higher of the two ranks; without DISTINCT ON the two
    // would be one statement writing the same row twice, which Postgres
    // refuses outright.
    await this.client.queryArray(
      `INSERT INTO listings (department, asin, page, position)
       SELECT DISTINCT ON (listed.asin) $1, listed.asin, $2, listed.position
       FROM unnest($3::text[]) WITH ORDINALITY AS listed(asin, position)
       ORDER BY listed.asin, listed.position
       ON CONFLICT (department, asin)
       DO UPDATE SET page = excluded.page, position = excluded.position`,
      [department, page, asins],
    );
  }

  /** What this department's listings ranked and no walk has read yet. */
  async unread(department: string): Promise<string[]> {
    const { rows } = await this.client.queryArray<[string]>(
      `SELECT l.asin FROM listings l
       LEFT JOIN products p ON p.asin = l.asin
       WHERE l.department = $1 AND p.asin IS NULL AND l.attempts < $2
       ORDER BY l.page, l.position`,
      [department, MAX_ATTEMPTS],
    );
    return rows.map(([asin]) => asin);
  }

  /** Counts a read of a queued product that came back with nothing. */
  async missed(department: string, asin: string): Promise<void> {
    await this.client.queryArray(
      `UPDATE listings SET attempts = attempts + 1
       WHERE department = $1 AND asin = $2`,
      [department, asin],
    );
  }

  /** Gives every listing this department gave up on another chance. */
  async retryMissed(department: string): Promise<void> {
    await this.client.queryArray(
      "UPDATE listings SET attempts = 0 WHERE department = $1",
      [department],
    );
  }

  /** The listing page a walk of this department should list next. */
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

  /**
   * The records of a department due to be checked against Amazon, the ones it
   * has been longest since checking first and the ones never checked before
   * them. A capped audit picks up where the last one stopped, so a catalog is
   * worked through over as many runs as it takes.
   */
  async toAudit(department: string, limit: number): Promise<string[]> {
    const { rows } = await this.client.queryArray<[string]>(
      `SELECT p.asin FROM products p
       LEFT JOIN audits a ON a.asin = p.asin
       WHERE p.department = $1
       ORDER BY a.checked_at ASC NULLS FIRST, p.asin
       LIMIT $2`,
      // An audit of everything the department holds asks for no limit at all.
      [department, Number.isFinite(limit) ? limit : null],
    );
    return rows.map(([asin]) => asin);
  }

  /** The row the catalog holds for a product, in the columns' own order. */
  async record(asin: string): Promise<unknown[] | undefined> {
    const { rows } = await this.client.queryArray(
      `SELECT ${TABLES.products.join(", ")} FROM products WHERE asin = $1`,
      [asin],
    );
    return rows[0];
  }

  /** Keeps what an audit made of a record, in place of what the last one did. */
  async audited(finding: Finding): Promise<void> {
    await this.client.queryArray("BEGIN");
    try {
      await this.client.queryArray(
        `INSERT INTO audits (${TABLES.audits.join(", ")})
         VALUES (${placeholders(TABLES.audits.length)})
         ON CONFLICT (asin) DO UPDATE
           SET checked_at = excluded.checked_at, verdict = excluded.verdict`,
        [finding.asin, finding.checkedAt, finding.verdict],
      );
      await this.client.queryArray(
        "DELETE FROM audit_differences WHERE asin = $1",
        [finding.asin],
      );
      await this.insert(
        "audit_differences",
        finding.differences.map((difference) => [
          finding.asin,
          difference.field,
          difference.stored,
          difference.found,
        ]),
      );
      await this.client.queryArray("COMMIT");
    } catch (error) {
      await this.client.queryArray("ROLLBACK");
      throw error;
    }
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
    const categories = await this.categoriesFor(product);

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

    await this.file(asin, categories);

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

  /** Files a product under the categories given, and under those alone. */
  private async file(asin: string, categories: number[]): Promise<void> {
    await this.client.queryArray(
      "DELETE FROM product_categories WHERE asin = $1",
      [asin],
    );
    await this.insert(
      "product_categories",
      categories.map((category) => [asin, category]),
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

/** A product as the products table holds it, column by column. */
export function productRow(product: Product): unknown[] {
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
