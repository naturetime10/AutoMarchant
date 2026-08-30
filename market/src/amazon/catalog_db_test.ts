import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { CatalogDb, TABLES } from "./catalog_db.ts";
import type { Product } from "./product.ts";

const product = (asin: string, over: Partial<Product> = {}): Product => ({
  asin,
  url: `https://www.amazon.com/dp/${asin}`,
  department: "electronics",
  capturedAt: "2026-08-29T00:00:00.000Z",
  title: "A cable",
  brand: "Anker",
  breadcrumbs: ["Electronics", "Cables"],
  images: [],
  price: { amount: 12.99, currency: "USD", text: "$12.99" },
  rating: { average: 4.5, count: 12 },
  store: { name: "Anker", soldBy: "AnkerDirect" },
  features: ["Fast"],
  details: { Style: "Braided" },
  variations: { Color: "Black" },
  measurements: { Length: "6 ft" },
  stylingIdeas: [],
  questions: [],
  reviews: [{ verifiedPurchase: true, rating: 5, title: "Good" }],
  ...over,
});

const inTempDb = async (
  test: (db: CatalogDb, path: string) => void | Promise<void>,
) => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/catalog.db`;
  const db = CatalogDb.open(path);
  try {
    await test(db, path);
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
};

const count = (path: string, table: string, asin: string): number => {
  const db = new DatabaseSync(path);
  const row = db.prepare(`SELECT count(*) AS n FROM ${table} WHERE asin = ?`)
    .get(asin) as { n: number };
  db.close();
  return row.n;
};

Deno.test("CatalogDb knows a product it has saved", async () => {
  await inTempDb((db) => {
    assertEquals(db.has("B000000001"), false);
    db.save(product("B000000001"), []);
    assertEquals(db.has("B000000001"), true);
  });
});

Deno.test("CatalogDb stores the scalars a spreadsheet would total", async () => {
  await inTempDb((db, path) => {
    db.save(product("B000000001"), []);

    const raw = new DatabaseSync(path);
    const row = raw.prepare("SELECT * FROM products WHERE asin = ?")
      .get("B000000001") as Record<string, unknown>;
    raw.close();

    assertEquals(row.title, "A cable");
    assertEquals(row.price, 12.99);
    assertEquals(row.currency, "USD");
    assertEquals(row.rating_average, 4.5);
    assertEquals(row.rating_count, 12);
    assertEquals(row.sold_by, "AnkerDirect");
    assertEquals(row.breadcrumbs, "Electronics > Cables");
  });
});

Deno.test("CatalogDb keeps each kind of attribute apart", async () => {
  await inTempDb((db, path) => {
    db.save(product("B000000001"), []);

    const raw = new DatabaseSync(path);
    const kinds = raw.prepare(
      "SELECT kind, key, value FROM attributes WHERE asin = ? ORDER BY kind",
    ).all("B000000001");
    raw.close();

    assertEquals(kinds, [
      { kind: "detail", key: "Style", value: "Braided" },
      { kind: "measurement", key: "Length", value: "6 ft" },
      { kind: "variation", key: "Color", value: "Black" },
    ]);
  });
});

Deno.test("CatalogDb replaces a product's rows rather than doubling them", async () => {
  await inTempDb((db, path) => {
    db.save(product("B000000001"), []);
    db.save(
      product("B000000001", {
        reviews: [
          { verifiedPurchase: false, title: "First" },
          { verifiedPurchase: true, title: "Second" },
        ],
      }),
      [],
    );

    assertEquals(count(path, "products", "B000000001"), 1);
    assertEquals(count(path, "reviews", "B000000001"), 2);
    assertEquals(count(path, "attributes", "B000000001"), 3);
  });
});

Deno.test("CatalogDb keeps one capture per visit, so a price can be traced", async () => {
  await inTempDb((db, path) => {
    db.save(product("B000000001"), []);
    db.save(
      product("B000000001", {
        capturedAt: "2026-09-05T00:00:00.000Z",
        price: { amount: 9.99, currency: "USD", text: "$9.99" },
      }),
      [],
    );

    const raw = new DatabaseSync(path);
    const prices = raw.prepare(
      "SELECT price FROM captures WHERE asin = ? ORDER BY captured_at",
    ).all("B000000001");
    raw.close();

    assertEquals(prices, [{ price: 12.99 }, { price: 9.99 }]);
  });
});

Deno.test("CatalogDb records where an image was saved", async () => {
  await inTempDb((db, path) => {
    db.save(product("B000000001"), [
      {
        url: "https://m.media-amazon.com/images/I/1.jpg",
        path: "images/B000000001/01.jpg",
      },
      { url: "https://m.media-amazon.com/images/I/2.jpg" },
    ]);

    const raw = new DatabaseSync(path);
    const images = raw.prepare(
      "SELECT position, url, path FROM images WHERE asin = ? ORDER BY position",
    ).all("B000000001");
    raw.close();

    assertEquals(images[0], {
      position: 1,
      url: "https://m.media-amazon.com/images/I/1.jpg",
      path: "images/B000000001/01.jpg",
    });
    assertEquals((images[1] as { path: unknown }).path, null);
  });
});

Deno.test("CatalogDb counts what a department holds", async () => {
  await inTempDb((db) => {
    db.save(product("B000000001"), []);
    db.save(product("B000000002"), []);
    db.save(product("B000000003", { department: "books" }), []);

    assertEquals(db.count("electronics"), 2);
    assertEquals(db.count("books"), 1);
  });
});

Deno.test("CatalogDb finds what an earlier run saved", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const first = CatalogDb.open(`${dir}/catalog.db`);
    first.save(product("B000000001"), []);
    first.close();

    const second = CatalogDb.open(`${dir}/catalog.db`);
    assertEquals(second.has("B000000001"), true);
    second.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CatalogDb declares the same columns the schema creates", async () => {
  await inTempDb((db, path) => {
    db.save(product("B000000001"), []);

    const raw = new DatabaseSync(path);
    for (const [table, columns] of Object.entries(TABLES)) {
      const actual = raw.prepare(`PRAGMA table_info(${table})`).all()
        .map((column) => (column as { name: string }).name);
      assertEquals(actual, [...columns], table);
    }
    raw.close();
  });
});

Deno.test("CatalogDb reads a table back in its declared column order", async () => {
  await inTempDb((db) => {
    db.save(product("B000000001"), []);

    const [row] = db.rows("products");
    assertEquals(row[TABLES.products.indexOf("asin")], "B000000001");
    assertEquals(row[TABLES.products.indexOf("price")], 12.99);
    assertEquals(row.length, TABLES.products.length);
  });
});
