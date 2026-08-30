import { assertEquals } from "@std/assert";
import { CsvExport } from "./csv_export.ts";
import type { Product } from "./product.ts";

const product = (asin: string, over: Partial<Product> = {}): Product => ({
  asin,
  url: `https://www.amazon.com/dp/${asin}`,
  department: "electronics",
  capturedAt: "2026-08-29T00:00:00.000Z",
  title: "A cable, braided",
  breadcrumbs: ["Electronics", "Cables"],
  images: [],
  rating: { average: 4.5, count: 12 },
  store: {},
  features: ["Fast", "Braided"],
  details: { Style: "Braided" },
  variations: {},
  measurements: {},
  stylingIdeas: [],
  questions: [],
  reviews: [
    { verifiedPurchase: true, rating: 5, title: "Good" },
    { verifiedPurchase: false, rating: 3, title: "Fine" },
  ],
  ...over,
});

const lines = async (dir: string, file: string): Promise<string[]> =>
  (await Deno.readTextFile(`${dir}/${file}`)).trimEnd().split("\n");

const inTempDir = async (test: (dir: string) => Promise<void>) => {
  const dir = await Deno.makeTempDir();
  try {
    await test(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
};

Deno.test("CsvExport gives each kind of row a file of its own", async () => {
  await inTempDir(async (dir) => {
    const csv = await CsvExport.open(dir);
    await csv.append(product("B000000001"), [
      {
        url: "https://m.media-amazon.com/images/I/1.jpg",
        path: "images/B000000001/01.jpg",
      },
    ]);

    assertEquals((await lines(dir, "products.csv")).length, 2);
    assertEquals((await lines(dir, "reviews.csv")).length, 3);
    assertEquals((await lines(dir, "attributes.csv")).length, 2);
    assertEquals((await lines(dir, "captures.csv")).length, 2);
    assertEquals((await lines(dir, "images.csv")).length, 2);
    assertEquals((await lines(dir, "features.csv")).length, 3);
  });
});

Deno.test("CsvExport keys every child row back to its product", async () => {
  await inTempDir(async (dir) => {
    const csv = await CsvExport.open(dir);
    await csv.append(product("B000000001"), []);

    const [header, first] = await lines(dir, "reviews.csv");
    assertEquals(
      header,
      "asin,position,title,author,rating,date,verified_purchase,body,helpful_votes",
    );
    assertEquals(first, "B000000001,1,Good,,5,,true,,");

    const attributes = await lines(dir, "attributes.csv");
    assertEquals(attributes[0], "asin,kind,key,value");
    assertEquals(attributes[1], "B000000001,detail,Style,Braided");
  });
});

Deno.test("CsvExport quotes a product row that holds a comma", async () => {
  await inTempDir(async (dir) => {
    const csv = await CsvExport.open(dir);
    await csv.append(product("B000000001"), []);

    const [header, row] = await lines(dir, "products.csv");
    assertEquals(
      header.startsWith("asin,url,department,captured_at,title"),
      true,
    );
    assertEquals(row.includes('"A cable, braided"'), true);
    assertEquals(row.includes("Electronics > Cables"), true);
  });
});

Deno.test("CsvExport heads each file once, however often it reopens", async () => {
  await inTempDir(async (dir) => {
    await (await CsvExport.open(dir)).append(product("B000000001"), []);
    await (await CsvExport.open(dir)).append(product("B000000002"), []);

    const rows = await lines(dir, "products.csv");
    assertEquals(rows.length, 3);
    assertEquals(rows.filter((row) => row.startsWith("asin,")).length, 1);
  });
});
