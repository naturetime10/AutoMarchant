import { assertEquals, assertThrows } from "@std/assert";
import { AuditSettings, differences } from "./audit.ts";
import { productRow } from "./catalog_db.ts";
import { DEPARTMENTS } from "./departments.ts";
import type { Product } from "./product.ts";

const DEFAULTS = {
  outputDir: "../output/market/discover",
  databaseUrl: "postgresql://localhost:5432/automerchant",
  concurrency: 5,
};

const product = (over: Partial<Product> = {}): Product => ({
  asin: "B000000001",
  url: "https://www.amazon.com/dp/B000000001",
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

/** The row the catalog holds, as Postgres hands it back: dates as dates. */
const stored = (over: Partial<Product> = {}): unknown[] =>
  productRow(product(over)).map((value, column) =>
    column === 3 ? new Date(value as string) : value
  );

Deno.test("a record that still reads the way its page does differs in nothing", () => {
  assertEquals(differences(stored(), productRow(product())), []);
});

Deno.test("a price that has moved is a difference, both ways round", () => {
  assertEquals(
    differences(
      stored(),
      productRow(
        product({ price: { amount: 9.99, currency: "USD", text: "$9.99" } }),
      ),
    ),
    [{ field: "price", stored: "12.99", found: "9.99" }],
  );
});

Deno.test("a field the page no longer carries is a difference of its own", () => {
  assertEquals(
    differences(stored(), productRow(product({ brand: undefined, store: {} }))),
    [
      { field: "brand", stored: "Anker", found: null },
      { field: "store_name", stored: "Anker", found: null },
    ],
  );
});

Deno.test("an audit does not judge the ASIN, the URL, or when it was read", () => {
  assertEquals(
    differences(
      stored(),
      productRow(product({
        url: "https://www.amazon.com/Anker-Cable/dp/B000000001?ref=sr_1_1",
        department: "computers",
        capturedAt: "2026-09-30T00:00:00.000Z",
      })),
    ),
    [],
  );
});

Deno.test("audit settings check every department by default", () => {
  const settings = AuditSettings.parse([], DEFAULTS);

  assertEquals(settings.departments.length, DEPARTMENTS.length);
  assertEquals(settings.maxProducts, Number.POSITIVE_INFINITY);
  assertEquals(settings.outputDir, DEFAULTS.outputDir);
  assertEquals(settings.databaseUrl, DEFAULTS.databaseUrl);
  assertEquals(settings.concurrency, 5);
  assertEquals(settings.pauseMs, 1200);
  // An audit reads and reports until it is asked to do otherwise.
  assertEquals(settings.fix, false);
  assertEquals(settings.imageLimit, Number.POSITIVE_INFINITY);
});

Deno.test("audit settings write the page over the record when asked to fix", () => {
  const settings = AuditSettings.parse(["--fix", "--images=0"], DEFAULTS);

  assertEquals(settings.fix, true);
  assertEquals(settings.imageLimit, 0);
});

Deno.test("audit settings narrow the check to the flags given", () => {
  const settings = AuditSettings.parse(
    ["--departments=books", "--products=20", "--pause=0", "--concurrency=2"],
    DEFAULTS,
  );

  assertEquals(settings.departments.map((department) => department.slug), [
    "books",
  ]);
  assertEquals(settings.maxProducts, 20);
  assertEquals(settings.pauseMs, 0);
  assertEquals(settings.concurrency, 2);
});

Deno.test("audit settings refuse a flag the audit has no use for", () => {
  assertThrows(
    () => AuditSettings.parse(["--pages=2"], DEFAULTS),
    Error,
    "Unknown audit option: --pages",
  );
});
