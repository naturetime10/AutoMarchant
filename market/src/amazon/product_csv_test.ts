import { assertEquals } from "@std/assert";
import { ProductCsv } from "./product_csv.ts";
import type { Product } from "./product.ts";

const bare = (): Product => ({
  asin: "B000000001",
  url: "https://www.amazon.com/dp/B000000001",
  department: "electronics",
  capturedAt: "2026-08-29T00:00:00.000Z",
  breadcrumbs: [],
  images: [],
  rating: {},
  store: {},
  features: [],
  details: {},
  variations: {},
  measurements: {},
  stylingIdeas: [],
  questions: [],
  reviews: [],
});

Deno.test("the header names every column once", () => {
  assertEquals(ProductCsv.header(), `${ProductCsv.COLUMNS.join(",")}\n`);
  assertEquals(new Set(ProductCsv.COLUMNS).size, ProductCsv.COLUMNS.length);
});

Deno.test("a row carries one cell per column, filled or empty", () => {
  const cells = ProductCsv.row(bare()).trimEnd().split(",");

  assertEquals(cells.length, ProductCsv.COLUMNS.length);
  assertEquals(cells[ProductCsv.COLUMNS.indexOf("asin")], "B000000001");
  assertEquals(cells[ProductCsv.COLUMNS.indexOf("title")], "");
});

Deno.test("a row ends in a newline, so products append cleanly", () => {
  assertEquals(ProductCsv.row(bare()).endsWith("\n"), true);
});

Deno.test("lists become one cell, nested fields become JSON", () => {
  const row = ProductCsv.row({
    ...bare(),
    breadcrumbs: ["Electronics", "Cables"],
    features: ["Fast", "Braided"],
    details: { Style: "Braided" },
    reviews: [{ verifiedPurchase: true, rating: 5 }],
  });

  assertEquals(row.includes("Electronics | Cables"), true);
  assertEquals(row.includes("Fast | Braided"), true);
  assertEquals(row.includes('"{""Style"":""Braided""}"'), true);
  assertEquals(
    row.includes('"[{""verifiedPurchase"":true,""rating"":5}]"'),
    true,
  );
});

Deno.test("money and ratings split into columns a spreadsheet can total", () => {
  const cells = ProductCsv.row({
    ...bare(),
    price: { amount: 12.99, currency: "USD", text: "$12.99" },
    listPrice: { amount: 19.99, currency: "USD", text: "$19.99" },
    rating: { average: 4.5, count: 12345 },
  }).trimEnd().split(",");

  const columns: readonly string[] = ProductCsv.COLUMNS;
  const cell = (name: string) => cells[columns.indexOf(name)];
  assertEquals(cell("price"), "12.99");
  assertEquals(cell("listPrice"), "19.99");
  assertEquals(cell("currency"), "USD");
  assertEquals(cell("ratingAverage"), "4.5");
  assertEquals(cell("ratingCount"), "12345");
});

Deno.test("a cell that would break the format is quoted", () => {
  const row = ProductCsv.row({
    ...bare(),
    title: 'He said "hi", loudly\nagain',
  });

  assertEquals(row.includes('"He said ""hi"", loudly\nagain"'), true);
});
