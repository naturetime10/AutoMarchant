import { assertEquals } from "@std/assert";
import { CatalogStore } from "./catalog_store.ts";
import type { Product } from "./product.ts";

const product = (asin: string): Product => ({
  asin,
  url: `https://www.amazon.com/dp/${asin}`,
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

Deno.test("CatalogStore appends one JSON line per product", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = await CatalogStore.open(dir, "electronics");
    await store.append(product("B000000001"));
    await store.append(product("B000000002"));

    const lines = (await Deno.readTextFile(`${dir}/electronics.jsonl`))
      .trimEnd().split("\n");
    assertEquals(lines.length, 2);
    assertEquals(JSON.parse(lines[0]).asin, "B000000001");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CatalogStore reopens knowing what an earlier run captured", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const first = await CatalogStore.open(dir, "electronics");
    await first.append(product("B000000001"));

    const second = await CatalogStore.open(dir, "electronics");
    assertEquals(second.size, 1);
    assertEquals(second.has("B000000001"), true);
    assertEquals(second.has("B000000002"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CatalogStore survives the half-written line of a killed run", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/electronics.jsonl`,
      '{"asin":"B000000001"}\n{"asin":"B0000',
    );
    const store = await CatalogStore.open(dir, "electronics");
    assertEquals(store.size, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CatalogStore starts empty in a directory that does not exist yet", async () => {
  const parent = await Deno.makeTempDir();
  try {
    const store = await CatalogStore.open(`${parent}/catalog`, "books");
    assertEquals(store.size, 0);
    await store.append(product("B000000003"));
    assertEquals(store.has("B000000003"), true);
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("CatalogStore writes a CSV beside the JSON lines", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = await CatalogStore.open(dir, "electronics");
    await store.append(product("B000000001"));
    await store.append(product("B000000002"));

    const lines = (await Deno.readTextFile(`${dir}/electronics.csv`))
      .trimEnd().split("\n");
    assertEquals(lines.length, 3);
    assertEquals(lines[0].startsWith("asin,url,department"), true);
    assertEquals(lines[1].startsWith("B000000001,"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CatalogStore heads the CSV once, however often it reopens", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await (await CatalogStore.open(dir, "electronics")).append(
      product("B000000001"),
    );
    await (await CatalogStore.open(dir, "electronics")).append(
      product("B000000002"),
    );

    const lines = (await Deno.readTextFile(`${dir}/electronics.csv`))
      .trimEnd().split("\n");
    assertEquals(lines.length, 3);
    assertEquals(lines.filter((line) => line.startsWith("asin,")).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
