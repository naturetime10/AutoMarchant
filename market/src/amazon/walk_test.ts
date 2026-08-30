import { assertEquals } from "@std/assert";
import { Catalog } from "./catalog.ts";
import { type Department, selectDepartments } from "./departments.ts";
import {
  DiscoverySettings,
  type Pages,
  type Reader,
  Walk,
} from "./discovery.ts";
import { ImageStore } from "./image_store.ts";
import { RunLog } from "../run_log.ts";
import type { Product } from "./product.ts";
import { test, TEST_DATABASE_URL, truncate } from "./testing.ts";

const [ELECTRONICS] = selectDepartments(["electronics"]);

const DEFAULTS = {
  outputDir: "../output/market/discover",
  databaseUrl: TEST_DATABASE_URL,
  concurrency: 1,
};

/**
 * The listings a walk is handed, a page at a time, and every product they
 * rank. It remembers the pages it was asked for, which is what says where a
 * walk started and how far it got.
 */
class Listings implements Pages, Reader {
  readonly opened: number[] = [];

  constructor(private readonly pages: Record<number, string[]>) {}

  list(_department: Department, page: number): Promise<string[]> {
    this.opened.push(page);
    return Promise.resolve(this.pages[page] ?? []);
  }

  async each(
    asins: Iterable<string>,
    read: (asin: string, reader: Reader) => Promise<void>,
  ): Promise<void> {
    for (const asin of asins) await read(asin, this);
  }

  read(asin: string, department: Department): Promise<Product | undefined> {
    return Promise.resolve({
      asin,
      url: `https://www.amazon.com/dp/${asin}`,
      department: department.slug,
      capturedAt: "2026-08-30T00:00:00.000Z",
      title: `Product ${asin}`,
      breadcrumbs: [],
      images: [],
      rating: {},
      store: {},
      features: [],
      details: {},
      variations: {},
      measurements: {},
      questions: [],
      reviews: [],
    });
  }
}

/** A walk of Electronics over the listings given, on the test database. */
const walking = async (
  pages: Record<number, string[]>,
  options: string[],
  body: (listings: Listings, catalog: Catalog) => Promise<void>,
) => {
  const dir = await Deno.makeTempDir();
  const listings = new Listings(pages);
  const catalog = await Catalog.open(
    dir,
    TEST_DATABASE_URL,
    new ImageStore(dir),
  );
  const log = await RunLog.open(dir, "discover.log", () => {});
  try {
    const settings = DiscoverySettings.parse(options, DEFAULTS);
    await new Walk(settings, listings, catalog, log).of(ELECTRONICS);
    await body(listings, catalog);
  } finally {
    await catalog.close();
    await Deno.remove(dir, { recursive: true });
  }
};

test("a walk opens the page the last walk of the department stopped on", async () => {
  await truncate();
  const pages = { 3: ["B000000031"], 4: ["B000000041"] };

  await walking(pages, ["--pages=2"], async (listings, catalog) => {
    // Nothing kept yet, so the first walk starts at the top.
    assertEquals(listings.opened, [1]);
    await catalog.keepPlace("electronics", 3);
  });

  await walking(pages, ["--pages=2"], async (listings, catalog) => {
    assertEquals(listings.opened, [3, 4]);
    // Both pages were read through, so the next walk opens the one after.
    assertEquals(await catalog.nextPage("electronics"), 5);
  });
});

test("a walk out of products stays on the page it was reading", async () => {
  await truncate();
  const pages = { 1: ["B000000011", "B000000012", "B000000013"] };

  await walking(pages, ["--products=2"], async (_listings, catalog) => {
    // Two of the three were read, so the page is not walked out yet.
    assertEquals(await catalog.nextPage("electronics"), 1);
    assertEquals(await catalog.count("electronics"), 2);
  });
});

test("a walk that reads a page through steps over it", async () => {
  await truncate();
  const pages = { 1: ["B000000011"], 2: ["B000000021"] };

  await walking(pages, ["--pages=1"], async (_listings, catalog) => {
    assertEquals(await catalog.nextPage("electronics"), 2);
  });
});

test("a walk to the end of the listings forgets where it was", async () => {
  await truncate();

  await walking({ 1: ["B000000011"] }, [], async (listings, catalog) => {
    // Page 2 ranks nothing, which is how the listings end.
    assertEquals(listings.opened, [1, 2]);
    // So the next walk starts at the top, where a listing puts what it has
    // newly ranked.
    assertEquals(await catalog.nextPage("electronics"), 1);
  });
});

test("a restart walks the department from the top again", async () => {
  await truncate();
  const pages = { 1: ["B000000011"], 5: ["B000000051"] };

  await walking(pages, ["--pages=1"], async (_listings, catalog) => {
    await catalog.keepPlace("electronics", 5);
  });

  await walking(pages, ["--pages=1", "--restart"], (listings) => {
    assertEquals(listings.opened, [1]);
    return Promise.resolve();
  });
});
