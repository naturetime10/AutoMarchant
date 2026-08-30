import { assertEquals } from "@std/assert";
import { Catalog } from "./catalog.ts";
import { ImageStore } from "./image_store.ts";
import { test, TEST_DATABASE_URL, truncate } from "./testing.ts";
import type { Product } from "./product.ts";

const product: Product = {
  asin: "B000000001",
  url: "https://www.amazon.com/dp/B000000001",
  department: "electronics",
  capturedAt: "2026-08-29T00:00:00.000Z",
  title: "A cable",
  breadcrumbs: [],
  images: ["https://m.media-amazon.com/images/I/1.jpg"],
  rating: {},
  store: {},
  features: [],
  details: {},
  variations: {},
  measurements: {},
  stylingIdeas: [],
  questions: [],
  reviews: [],
};

test("Catalog saves the product, its image, and its CSV row together", async () => {
  await truncate();
  const dir = await Deno.makeTempDir();
  const images = new ImageStore(
    dir,
    () => Promise.resolve(new Uint8Array([1])),
  );
  const catalog = await Catalog.open(dir, TEST_DATABASE_URL, images);
  try {
    assertEquals(await catalog.has("B000000001"), false);
    await catalog.save(product);

    assertEquals(await catalog.has("B000000001"), true);
    assertEquals(await catalog.count("electronics"), 1);
    assertEquals((await Deno.stat(`${dir}/images/B000000001/01.jpg`)).size, 1);

    const rows = (await Deno.readTextFile(`${dir}/products.csv`)).trimEnd()
      .split("\n");
    assertEquals(rows.length, 2);
    assertEquals(rows[1].startsWith("B000000001,"), true);
    await catalog.close();
    const exported = (await Deno.readTextFile(`${dir}/products.csv`)).trimEnd()
      .split("\n");
    assertEquals(exported.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

test("Catalog leaves the CSV matching the catalog, not the visits", async () => {
  await truncate();
  const dir = await Deno.makeTempDir();
  const images = new ImageStore(
    dir,
    () => Promise.resolve(new Uint8Array([1])),
  );
  const catalog = await Catalog.open(dir, TEST_DATABASE_URL, images);
  try {
    await catalog.save(product);
    await catalog.save({ ...product, capturedAt: "2026-09-05T00:00:00.000Z" });
    await catalog.close();

    const products = (await Deno.readTextFile(`${dir}/products.csv`)).trimEnd()
      .split("\n");
    const captures = (await Deno.readTextFile(`${dir}/captures.csv`)).trimEnd()
      .split("\n");

    // One product, however often it was read; one capture per reading.
    assertEquals(products.length, 2);
    assertEquals(captures.length, 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
