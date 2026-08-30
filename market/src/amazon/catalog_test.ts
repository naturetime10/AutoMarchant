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
  questions: [],
  reviews: [],
};

test("Catalog saves the product and its image together", async () => {
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
    await catalog.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

test("Catalog keeps concurrent saves from treading on each other", async () => {
  await truncate();
  const dir = await Deno.makeTempDir();
  const images = new ImageStore(
    dir,
    () => Promise.resolve(new Uint8Array([1])),
  );
  const catalog = await Catalog.open(dir, TEST_DATABASE_URL, images);
  const products = Array.from({ length: 8 }, (_, index) => ({
    ...product,
    asin: `B10000000${index}`,
  }));
  try {
    // A concurrent walk saves from several tabs at once; each product still
    // has to land whole.
    await Promise.all(products.map((each) => catalog.save(each)));

    assertEquals(await catalog.count("electronics"), 8);
    for (const each of products) {
      assertEquals(await catalog.has(each.asin), true);
    }
    await catalog.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

test("Catalog keeps a failed save from taking a good one with it", async () => {
  await truncate();
  const dir = await Deno.makeTempDir();
  const images = new ImageStore(
    dir,
    () => Promise.resolve(new Uint8Array([1])),
  );
  const catalog = await Catalog.open(dir, TEST_DATABASE_URL, images);
  const good = { ...product, asin: "B200000001" };
  const bad = { ...product, asin: "B200000002", capturedAt: "not a date" };
  try {
    const [saved, refused] = await Promise.allSettled([
      catalog.save(good),
      catalog.save(bad),
    ]);

    assertEquals(saved.status, "fulfilled");
    assertEquals(refused.status, "rejected");
    assertEquals(await catalog.has(good.asin), true);
    assertEquals(await catalog.has(bad.asin), false);
    await catalog.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
