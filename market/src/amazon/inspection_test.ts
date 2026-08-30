import { assertEquals } from "@std/assert";
import { AuditSettings, Inspection } from "./audit.ts";
import { Catalog } from "./catalog.ts";
import { type Department, selectDepartments } from "./departments.ts";
import { ImageStore } from "./image_store.ts";
import type { Product } from "./product.ts";
import type { Reader, Readers } from "./tabs.ts";
import { RunLog } from "../run_log.ts";
import { query, test, TEST_DATABASE_URL, truncate } from "./testing.ts";

const [ELECTRONICS] = selectDepartments(["electronics"]);

const DEFAULTS = {
  outputDir: "../output/market/discover",
  databaseUrl: TEST_DATABASE_URL,
  concurrency: 1,
};

const product = (asin: string, over: Partial<Product> = {}): Product => ({
  asin,
  url: `https://www.amazon.com/dp/${asin}`,
  department: "electronics",
  capturedAt: "2026-08-30T00:00:00.000Z",
  title: "A cable",
  brand: "Anker",
  breadcrumbs: [],
  ranked: [],
  images: [],
  price: { amount: 12.99, currency: "USD", text: "$12.99" },
  rating: { average: 4.5, count: 12 },
  store: { name: "Anker" },
  features: [],
  details: {},
  variations: {},
  measurements: {},
  questions: [],
  reviews: [],
  ...over,
});

/** The pages an audit is handed, and the products they read as now. */
class Pages implements Readers, Reader {
  readonly readers: string[] = [];

  constructor(
    /** How each product's page reads now, where it reads differently. */
    private readonly now: Record<string, Partial<Product>> = {},
    /** The products whose page will not load at all. */
    private readonly gone: readonly string[] = [],
  ) {}

  async each(
    asins: Iterable<string>,
    read: (asin: string, reader: Reader) => Promise<void>,
  ): Promise<void> {
    for (const asin of asins) await read(asin, this);
  }

  read(asin: string, _department: Department): Promise<Product | undefined> {
    this.readers.push(asin);
    if (this.gone.includes(asin)) return Promise.resolve(undefined);
    return Promise.resolve(product(asin, this.now[asin] ?? {}));
  }
}

/** An audit of Electronics on the test database, against a clock it holds. */
const auditing = async (
  body: (
    catalog: Catalog,
    audit: (pages: Pages, ...options: string[]) => Promise<void>,
    said: readonly string[],
  ) => Promise<void>,
) => {
  await truncate();
  const dir = await Deno.makeTempDir();
  const catalog = await Catalog.open(
    dir,
    TEST_DATABASE_URL,
    new ImageStore(dir),
  );
  const said: string[] = [];
  const log = await RunLog.open(dir, "audit.log", (line) => said.push(line));
  // A run of its own each time, so what an audit checked first is the record
  // it had been longest since anyone looked at.
  let minute = 0;
  const clock = () => new Date(Date.UTC(2026, 8, 1, 0, ++minute));

  try {
    await body(
      catalog,
      (pages, ...options) =>
        new Inspection(
          AuditSettings.parse(options, DEFAULTS),
          pages,
          catalog,
          log,
          clock,
        ).of(ELECTRONICS),
      said,
    );
  } finally {
    await catalog.close();
    await Deno.remove(dir, { recursive: true });
  }
};

const verdicts = () =>
  query<{ asin: string; verdict: string }>(
    "SELECT asin, verdict FROM audits ORDER BY asin",
  );

test("an audit passes a record the page still agrees with", async () => {
  await auditing(async (catalog, audit) => {
    await catalog.save(product("B000000001"));

    await audit(new Pages());

    assertEquals(await verdicts(), [
      { asin: "B000000001", verdict: "matches" },
    ]);
    assertEquals(await query("SELECT * FROM audit_differences"), []);
  });
});

test("an audit records where a record and its page disagree", async () => {
  await auditing(async (catalog, audit, said) => {
    await catalog.save(product("B000000001"));

    await audit(
      new Pages({
        B000000001: {
          price: { amount: 9.99, currency: "USD", text: "$9.99" },
          title: "A braided cable",
        },
      }),
    );

    assertEquals(await verdicts(), [
      { asin: "B000000001", verdict: "differs" },
    ]);
    assertEquals(
      await query(
        "SELECT field, stored, found FROM audit_differences ORDER BY field",
      ),
      [
        { field: "price", stored: "12.99", found: "9.99" },
        { field: "title", stored: "A cable", found: "A braided cable" },
      ],
    );
    assertEquals(
      said.filter((line) => line.includes("B000000001")),
      // Named in the columns' own order, which is the order the table holds
      // them in rather than the order they were noticed.
      ["    B000000001  differs: title, price"],
    );
  });
});

test("an audit records a record with no page left behind it", async () => {
  await auditing(async (catalog, audit) => {
    await catalog.save(product("B000000001"));

    await audit(new Pages({}, ["B000000001"]));

    assertEquals(await verdicts(), [{ asin: "B000000001", verdict: "gone" }]);
  });
});

test("an audit checks the records it has been longest since checking", async () => {
  await auditing(async (catalog, audit) => {
    for (const asin of ["B000000001", "B000000002", "B000000003"]) {
      await catalog.save(product(asin));
    }

    // A record no audit has reached goes ahead of one that has been checked,
    // so an audit capped at one record works its way through the catalog.
    for (const asin of ["B000000001", "B000000002", "B000000003"]) {
      const pages = new Pages();
      await audit(pages, "--products=1");
      assertEquals(pages.readers, [asin]);
    }

    // Every record checked once, so the next audit comes back round to the
    // one checked longest ago.
    const again = new Pages();
    await audit(again, "--products=1");
    assertEquals(again.readers, ["B000000001"]);
  });
});

test("an audit asked to fix writes the page over the record it disagreed with", async () => {
  await auditing(async (catalog, audit) => {
    await catalog.save(product("B000000001"));

    await audit(
      new Pages({
        B000000001: {
          price: { amount: 9.99, currency: "USD", text: "$9.99" },
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
      }),
      "--fix",
    );

    assertEquals(await query("SELECT price FROM products"), [{ price: 9.99 }]);
    assertEquals(await verdicts(), [{ asin: "B000000001", verdict: "fixed" }]);
    // What was put right is kept: the finding says what the record used to
    // say, and the reading joins the price series like any other.
    assertEquals(
      await query("SELECT field, stored, found FROM audit_differences"),
      [{ field: "price", stored: "12.99", found: "9.99" }],
    );
    assertEquals(
      await query("SELECT price FROM captures ORDER BY captured_at"),
      [{ price: 12.99 }, { price: 9.99 }],
    );
  });
});

test("an audit not asked to fix leaves the record as it found it", async () => {
  await auditing(async (catalog, audit) => {
    await catalog.save(product("B000000001"));

    await audit(
      new Pages({
        B000000001: { price: { amount: 9.99, currency: "USD", text: "$9.99" } },
      }),
    );

    assertEquals(await query("SELECT price FROM products"), [{ price: 12.99 }]);
  });
});

test("a record with no page behind it is not one a fix can put right", async () => {
  await auditing(async (catalog, audit) => {
    await catalog.save(product("B000000001"));

    await audit(new Pages({}, ["B000000001"]), "--fix");

    // Nothing came back to write, so the record stands and says so.
    assertEquals(await verdicts(), [{ asin: "B000000001", verdict: "gone" }]);
    assertEquals(await query("SELECT title FROM products"), [
      { title: "A cable" },
    ]);
  });
});

test("an audit leaves the records of other departments alone", async () => {
  await auditing(async (catalog, audit) => {
    await catalog.save(product("B000000001"));
    await catalog.save(product("B000000002", { department: "books" }));

    const pages = new Pages();
    await audit(pages);

    assertEquals(pages.readers, ["B000000001"]);
  });
});

test("an audit says what it made of the department it checked", async () => {
  await auditing(async (catalog, audit, said) => {
    await catalog.save(product("B000000001"));
    await catalog.save(product("B000000002"));
    await catalog.save(product("B000000003"));

    await audit(
      new Pages({ B000000002: { title: "A braided cable" } }, ["B000000003"]),
    );

    assertEquals(
      said.filter((line) => line.includes("checked")),
      ["  electronics: 3 checked, 1 differs, 1 gone"],
    );
  });
});

test("an audit that fixes says so, rather than saying what still differs", async () => {
  await auditing(async (catalog, audit, said) => {
    await catalog.save(product("B000000001"));
    await catalog.save(product("B000000002"));

    await audit(
      new Pages({ B000000002: { title: "A braided cable" } }),
      "--fix",
    );

    assertEquals(
      said.filter((line) => line.includes("checked")),
      ["  electronics: 2 checked, 1 fixed, 0 gone"],
    );
    assertEquals(
      said.filter((line) => line.includes("B000000002")),
      ["    B000000002  fixed: title"],
    );
  });
});
