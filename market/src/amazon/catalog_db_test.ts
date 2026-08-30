import { assertEquals } from "@std/assert";
import { Client } from "@db/postgres";
import { CatalogDb, connection, TABLES } from "./catalog_db.ts";
import { test, TEST_DATABASE_URL, truncate } from "./testing.ts";
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

/** A trail deep enough to have a shape worth keeping. */
const BLENDERS = [
  "Home & Kitchen",
  "Kitchen & Dining",
  "Small Appliances",
  "Blenders",
  "Personal Size Blenders",
];

/** A catalog on the test database, emptied before the test runs. */
const inDb = async (body: (db: CatalogDb) => Promise<void>) => {
  await truncate();
  const db = await CatalogDb.open(TEST_DATABASE_URL);
  try {
    await body(db);
  } finally {
    await db.close();
  }
};

/** Reads the database directly, to check what the catalog actually wrote. */
const query = async <T>(sql: string, args: unknown[] = []): Promise<T[]> => {
  const client = new Client(connection(TEST_DATABASE_URL));
  await client.connect();
  try {
    const result = await client.queryObject<Record<string, unknown>>({
      text: sql,
      args,
    });
    return result.rows as T[];
  } finally {
    await client.end();
  }
};

/**
 * Every node with the trail that reaches it, walked down from the roots. The
 * tree keeps no path of its own, so the tests derive one to read it by.
 */
const PATHS = `
  WITH RECURSIVE paths AS (
    SELECT id, name AS path FROM categories WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, p.path || ' > ' || c.name
      FROM categories c JOIN paths p ON p.id = c.parent_id
  )`;

/** The trail a product is filed under, as the leaf's full path. */
const categoryOf = async (asin: string): Promise<string | null> => {
  const [row] = await query<{ path: string | null }>(
    `${PATHS}
     SELECT (SELECT path FROM paths WHERE paths.id = products.category_id)
       FROM products WHERE asin = $1`,
    [asin],
  );
  return row.path;
};

/** The whole tree, each node beside the parent it hangs from. */
const tree = () =>
  query<{ name: string; parent: string | null }>(
    `${PATHS}
     SELECT c.name, p.name AS parent FROM categories c
       LEFT JOIN categories p ON p.id = c.parent_id
       JOIN paths ON paths.id = c.id
      ORDER BY paths.path`,
  );

/** The products filed under a trail, or anywhere beneath it. */
const under = async (path: string): Promise<string[]> => {
  const rows = await query<{ asin: string }>(
    // The trail names where to start; parent_id carries it the rest of the way.
    `${PATHS}, sub AS (
       SELECT id FROM paths WHERE path = $1
       UNION ALL
       SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
     )
     SELECT p.asin FROM products p JOIN sub ON sub.id = p.category_id
      ORDER BY p.asin`,
    [path],
  );
  return rows.map((row) => row.asin);
};

// Scoped to public: information_schema has an "attributes" view of its own,
// whose columns would otherwise be mixed in.
const columnsOf = async (table: string): Promise<string[]> => {
  const rows = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => row.column_name);
};

const count = async (table: string, asin: string): Promise<number> => {
  const [row] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE asin = $1`,
    [asin],
  );
  return row.n;
};

test("CatalogDb knows a product it has saved", async () => {
  await inDb(async (db) => {
    assertEquals(await db.has("B000000001"), false);
    await db.save(product("B000000001"), []);
    assertEquals(await db.has("B000000001"), true);
  });
});

test("CatalogDb stores the scalars a spreadsheet would total", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), []);

    const [row] = await query<Record<string, unknown>>(
      "SELECT * FROM products WHERE asin = $1",
      ["B000000001"],
    );

    assertEquals(row.title, "A cable");
    assertEquals(row.price, 12.99);
    assertEquals(row.currency, "USD");
    assertEquals(row.rating_average, 4.5);
    assertEquals(row.rating_count, 12);
    assertEquals(row.sold_by, "AnkerDirect");
    assertEquals(
      (row.captured_at as Date).toISOString(),
      "2026-08-29T00:00:00.000Z",
    );
  });
});

test("CatalogDb keeps each kind of attribute apart", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), []);

    assertEquals(
      await query("SELECT kind, key, value FROM attributes ORDER BY kind"),
      [
        { kind: "detail", key: "Style", value: "Braided" },
        { kind: "measurement", key: "Length", value: "6 ft" },
        { kind: "variation", key: "Color", value: "Black" },
      ],
    );
  });
});

test("CatalogDb replaces a product's rows rather than doubling them", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), []);
    await db.save(
      product("B000000001", {
        reviews: [
          { verifiedPurchase: false, title: "First" },
          { verifiedPurchase: true, title: "Second" },
        ],
      }),
      [],
    );

    assertEquals(await count("products", "B000000001"), 1);
    assertEquals(await count("reviews", "B000000001"), 2);
    assertEquals(await count("attributes", "B000000001"), 3);
  });
});

test("CatalogDb keeps one capture per visit, so a price can be traced", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), []);
    await db.save(
      product("B000000001", {
        capturedAt: "2026-09-05T00:00:00.000Z",
        price: { amount: 9.99, currency: "USD", text: "$9.99" },
      }),
      [],
    );

    assertEquals(
      await query("SELECT price FROM captures ORDER BY captured_at"),
      [{ price: 12.99 }, { price: 9.99 }],
    );
  });
});

test("CatalogDb records where an image was saved", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), [
      {
        url: "https://m.media-amazon.com/images/I/1.jpg",
        path: "images/B000000001/01.jpg",
      },
      { url: "https://m.media-amazon.com/images/I/2.jpg" },
    ]);

    assertEquals(
      await query("SELECT position, url, path FROM images ORDER BY position"),
      [
        {
          position: 1,
          url: "https://m.media-amazon.com/images/I/1.jpg",
          path: "images/B000000001/01.jpg",
        },
        {
          position: 2,
          url: "https://m.media-amazon.com/images/I/2.jpg",
          path: null,
        },
      ],
    );
  });
});

test("CatalogDb counts what a department holds", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), []);
    await db.save(product("B000000002"), []);
    await db.save(product("B000000003", { department: "books" }), []);

    assertEquals(await db.count("electronics"), 2);
    assertEquals(await db.count("books"), 1);
  });
});

test("CatalogDb finds what an earlier connection saved", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), []);
  });

  const later = await CatalogDb.open(TEST_DATABASE_URL);
  try {
    assertEquals(await later.has("B000000001"), true);
  } finally {
    await later.close();
  }
});

test("CatalogDb declares the same columns the schema creates", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), []);

    for (const [table, columns] of Object.entries(TABLES)) {
      assertEquals(await columnsOf(table), [...columns], table);
    }
  });
});

test("CatalogDb keeps a book's author", async () => {
  await inDb(async (db) => {
    await db.save(
      product("B000000001", {
        department: "books",
        brand: undefined,
        author: "Amy Long",
        store: { soldBy: "Amazon.com" },
      }),
      [],
    );

    assertEquals(
      await query("SELECT author, brand, store_name FROM products"),
      [{ author: "Amy Long", brand: null, store_name: null }],
    );
  });
});

test("CatalogDb moves a book's byline out of the store it is not", async () => {
  await truncate();
  // A catalog as an earlier walk left it: no author column, and the byline
  // filed as the brand and the storefront.
  const legacy = await CatalogDb.open(TEST_DATABASE_URL);
  await legacy.close();
  await query("ALTER TABLE products DROP COLUMN IF EXISTS author");
  await query(
    `INSERT INTO products (asin, url, department, captured_at, title, brand,
       store_name, store_url, sold_by)
     VALUES ($1, '', 'books', now(), 'The Subtle Art of Leadership', $2, $2,
       'https://www.amazon.com/stores/author/B0FFM8TWFH', 'Amazon.com')`,
    ["B000000001", "by Amy Long (Author) Format: Paperback"],
  );

  const db = await CatalogDb.open(TEST_DATABASE_URL);
  await db.close();

  assertEquals(
    await query(
      "SELECT author, brand, store_name, store_url, sold_by FROM products",
    ),
    [{
      author: "Amy Long",
      brand: null,
      store_name: null,
      store_url: null,
      sold_by: "Amazon.com",
    }],
  );
});

test("CatalogDb leaves a storefront byline where it is", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001"), []);
  });

  const later = await CatalogDb.open(TEST_DATABASE_URL);
  await later.close();

  assertEquals(
    await query("SELECT author, brand, store_name FROM products"),
    [{ author: null, brand: "Anker", store_name: "Anker" }],
  );
});

test("CatalogDb keeps the day a review was written as a moment in time", async () => {
  await inDb(async (db) => {
    await db.save(
      product("B000000001", {
        reviews: [
          { verifiedPurchase: true, date: "2024-05-01T00:00:00.000Z" },
          { verifiedPurchase: true },
        ],
      }),
      [],
    );

    const rows = await query<{ position: number; date: Date | null }>(
      "SELECT position, date FROM reviews ORDER BY position",
    );

    assertEquals(rows[0].date?.toISOString(), "2024-05-01T00:00:00.000Z");
    assertEquals(rows[1].date, null);
  });
});

test("CatalogDb reads a review date an earlier walk wrote in words", async () => {
  await truncate();
  // A catalog as an earlier walk left it: the day a review names kept as the
  // words the page wrote it in.
  const legacy = await CatalogDb.open(TEST_DATABASE_URL);
  await legacy.close();
  await query("ALTER TABLE reviews ALTER COLUMN date TYPE TEXT");
  await query(
    `INSERT INTO products (asin, url, department, captured_at)
     VALUES ('B000000001', '', 'electronics', now())`,
  );
  await query(
    `INSERT INTO reviews (asin, position, date, verified_purchase)
     VALUES ('B000000001', 1, 'May 1, 2024', true),
            ('B000000001', 2, 'Reviewed nowhere in particular', true),
            ('B000000001', 3, NULL, true)`,
  );

  const db = await CatalogDb.open(TEST_DATABASE_URL);
  await db.close();

  assertEquals(
    await query(
      // Read back in UTC, the zone the day was written down in.
      "SELECT position, to_char(date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day " +
        "FROM reviews ORDER BY position",
    ),
    [
      { position: 1, day: "2024-05-01" },
      { position: 2, day: null },
      { position: 3, day: null },
    ],
  );
});

test("CatalogDb files a product under the leaf of its trail", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001", { breadcrumbs: BLENDERS }), []);

    assertEquals(await categoryOf("B000000001"), BLENDERS.join(" > "));
    assertEquals(await tree(), [
      { name: "Home & Kitchen", parent: null },
      { name: "Kitchen & Dining", parent: "Home & Kitchen" },
      { name: "Small Appliances", parent: "Kitchen & Dining" },
      { name: "Blenders", parent: "Small Appliances" },
      { name: "Personal Size Blenders", parent: "Blenders" },
    ]);
  });
});

test("CatalogDb hangs two trails off the branch they share", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001", { breadcrumbs: BLENDERS }), []);
    await db.save(
      product("B000000002", {
        breadcrumbs: ["Home & Kitchen", "Kitchen & Dining", "Cookware"],
      }),
      [],
    );

    assertEquals(
      (await tree()).filter((node) => node.name === "Home & Kitchen").length,
      1,
    );
    assertEquals(await under("Home & Kitchen > Kitchen & Dining"), [
      "B000000001",
      "B000000002",
    ]);
    assertEquals(await under("Home & Kitchen > Kitchen & Dining > Cookware"), [
      "B000000002",
    ]);
  });
});

test("CatalogDb tells apart two categories that share a name", async () => {
  await inDb(async (db) => {
    await db.save(
      product("B000000001", { breadcrumbs: ["Electronics", "Accessories"] }),
      [],
    );
    await db.save(
      product("B000000002", { breadcrumbs: ["Books", "Accessories"] }),
      [],
    );

    assertEquals(await categoryOf("B000000001"), "Electronics > Accessories");
    assertEquals(await categoryOf("B000000002"), "Books > Accessories");
    assertEquals(await under("Electronics"), ["B000000001"]);
  });
});

test("CatalogDb files a product that named no trail under nothing", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001", { breadcrumbs: [] }), []);

    assertEquals(await categoryOf("B000000001"), null);
    assertEquals(await tree(), []);
  });
});

test("CatalogDb keeps a trail a rerun shortened", async () => {
  await inDb(async (db) => {
    await db.save(product("B000000001", { breadcrumbs: BLENDERS }), []);
    await db.save(
      product("B000000001", { breadcrumbs: ["Home & Kitchen", "Blenders"] }),
      [],
    );

    assertEquals(await categoryOf("B000000001"), "Home & Kitchen > Blenders");
    // The trail it left is a category still, whatever hangs under it now.
    assertEquals(await under(BLENDERS.join(" > ")), []);
  });
});

test("CatalogDb grows a tree from the trail a string held", async () => {
  await truncate();
  // A catalog as an earlier walk left it: the trail folded into one cell.
  const legacy = await CatalogDb.open(TEST_DATABASE_URL);
  await legacy.close();
  await query("ALTER TABLE products DROP COLUMN IF EXISTS category_id");
  await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS breadcrumbs TEXT");
  await query("DELETE FROM categories");
  await query(
    `INSERT INTO products (asin, url, department, captured_at, breadcrumbs)
     VALUES ($1, '', 'home', now(), $2), ($3, '', 'home', now(), $4)`,
    [
      "B000000001",
      BLENDERS.join(" > "),
      "B000000002",
      "Home & Kitchen > Kitchen & Dining > Cookware",
    ],
  );

  const db = await CatalogDb.open(TEST_DATABASE_URL);
  await db.close();

  assertEquals(await categoryOf("B000000001"), BLENDERS.join(" > "));
  assertEquals(await under("Home & Kitchen"), ["B000000001", "B000000002"]);
  assertEquals((await columnsOf("products")).includes("breadcrumbs"), false);
});
