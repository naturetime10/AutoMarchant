import { DatabaseSync } from "node:sqlite";
import type { StoredImage } from "./image_store.ts";
import type { Product } from "./product.ts";

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
    captured_at TEXT NOT NULL,
    title TEXT,
    brand TEXT,
    breadcrumbs TEXT,
    price REAL,
    list_price REAL,
    currency TEXT,
    rating_average REAL,
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
    aplus TEXT
  );
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
    rating REAL,
    date TEXT,
    verified_purchase INTEGER NOT NULL,
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

  -- One row per visit, so a price or a rating can be traced over time.
  CREATE TABLE IF NOT EXISTS captures (
    asin TEXT NOT NULL REFERENCES products (asin) ON DELETE CASCADE,
    captured_at TEXT NOT NULL,
    price REAL,
    list_price REAL,
    rating_average REAL,
    rating_count INTEGER,
    availability TEXT,
    PRIMARY KEY (asin, captured_at)
  );
`;

/**
 * Every table and its columns, in order. The CSV export reads this too, so a
 * file and the table behind it never drift apart.
 */
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
const OWNED = [
  "attributes",
  "features",
  "images",
  "reviews",
  "questions",
  "styling_ideas",
] as const;

/** The catalog a walk fills in, as a SQLite database. */
export class CatalogDb {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): CatalogDb {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA);
    return new CatalogDb(db);
  }

  has(asin: string): boolean {
    return this.db.prepare("SELECT 1 FROM products WHERE asin = ?").get(
      asin,
    ) !==
      undefined;
  }

  count(department: string): number {
    const row = this.db.prepare(
      "SELECT count(*) AS n FROM products WHERE department = ?",
    ).get(department) as { n: number };
    return row.n;
  }

  /** Writes a product and everything it owns, as one all-or-nothing step. */
  save(product: Product, images: StoredImage[]): void {
    this.db.exec("BEGIN");
    try {
      this.write(product, images);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Every row of a table, in the column order the schema declares. */
  rows(table: TableName): unknown[][] {
    const columns = TABLES[table].join(", ");
    return this.db.prepare(`SELECT ${columns} FROM ${table}`).all().map((row) =>
      TABLES[table].map((column) => (row as Record<string, unknown>)[column])
    );
  }

  close(): void {
    this.db.close();
  }

  private write(product: Product, images: StoredImage[]): void {
    this.db.prepare(
      `INSERT INTO products (
         asin, url, department, captured_at, title, brand, breadcrumbs,
         price, list_price, currency, rating_average, rating_count,
         answered_questions, availability, store_name, store_url, sold_by,
         ships_from, seller_url, style, description, aplus
       ) VALUES (${"?, ".repeat(21)}?)
       ON CONFLICT (asin) DO UPDATE SET
         url = excluded.url,
         department = excluded.department,
         captured_at = excluded.captured_at,
         title = excluded.title,
         brand = excluded.brand,
         breadcrumbs = excluded.breadcrumbs,
         price = excluded.price,
         list_price = excluded.list_price,
         currency = excluded.currency,
         rating_average = excluded.rating_average,
         rating_count = excluded.rating_count,
         answered_questions = excluded.answered_questions,
         availability = excluded.availability,
         store_name = excluded.store_name,
         store_url = excluded.store_url,
         sold_by = excluded.sold_by,
         ships_from = excluded.ships_from,
         seller_url = excluded.seller_url,
         style = excluded.style,
         description = excluded.description,
         aplus = excluded.aplus`,
    ).run(
      product.asin,
      product.url,
      product.department,
      product.capturedAt,
      text(product.title),
      text(product.brand),
      text(product.breadcrumbs.join(" > ")),
      number(product.price?.amount),
      number(product.listPrice?.amount),
      text(product.price?.currency ?? product.listPrice?.currency),
      number(product.rating.average),
      number(product.rating.count),
      number(product.answeredQuestions),
      text(product.availability),
      text(product.store.name),
      text(product.store.url),
      text(product.store.soldBy),
      text(product.store.shipsFrom),
      text(product.store.sellerUrl),
      text(product.style),
      text(product.description),
      text(product.aplus),
    );

    for (const table of OWNED) {
      this.db.prepare(`DELETE FROM ${table} WHERE asin = ?`).run(product.asin);
    }

    const attribute = this.db.prepare(
      "INSERT INTO attributes (asin, kind, key, value) VALUES (?, ?, ?, ?)",
    );
    for (const [kind, rows] of attributeKinds(product)) {
      for (const [key, value] of Object.entries(rows)) {
        attribute.run(product.asin, kind, key, value);
      }
    }

    const feature = this.db.prepare(
      "INSERT INTO features (asin, position, feature) VALUES (?, ?, ?)",
    );
    product.features.forEach((value, index) =>
      feature.run(product.asin, index + 1, value)
    );

    const idea = this.db.prepare(
      "INSERT INTO styling_ideas (asin, position, idea) VALUES (?, ?, ?)",
    );
    product.stylingIdeas.forEach((value, index) =>
      idea.run(product.asin, index + 1, value)
    );

    const image = this.db.prepare(
      "INSERT INTO images (asin, position, url, path) VALUES (?, ?, ?, ?)",
    );
    images.forEach((stored, index) =>
      image.run(product.asin, index + 1, stored.url, text(stored.path))
    );

    const review = this.db.prepare(
      `INSERT INTO reviews (
         asin, position, title, author, rating, date, verified_purchase,
         body, helpful_votes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    product.reviews.forEach((entry, index) =>
      review.run(
        product.asin,
        index + 1,
        text(entry.title),
        text(entry.author),
        number(entry.rating),
        text(entry.date),
        entry.verifiedPurchase ? 1 : 0,
        text(entry.body),
        number(entry.helpfulVotes),
      )
    );

    const question = this.db.prepare(
      "INSERT INTO questions (asin, position, question, answer, votes) VALUES (?, ?, ?, ?, ?)",
    );
    product.questions.forEach((entry, index) =>
      question.run(
        product.asin,
        index + 1,
        entry.question,
        text(entry.answer),
        number(entry.votes),
      )
    );

    this.db.prepare(
      `INSERT INTO captures (
         asin, captured_at, price, list_price, rating_average, rating_count,
         availability
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (asin, captured_at) DO NOTHING`,
    ).run(
      product.asin,
      product.capturedAt,
      number(product.price?.amount),
      number(product.listPrice?.amount),
      number(product.rating.average),
      number(product.rating.count),
      text(product.availability),
    );
  }
}

function attributeKinds(
  product: Product,
): Array<[string, Record<string, string>]> {
  return [
    ["detail", product.details],
    ["variation", product.variations],
    ["measurement", product.measurements],
  ];
}

function text(value?: string): string | null {
  return value ?? null;
}

function number(value?: number): number | null {
  return value ?? null;
}
