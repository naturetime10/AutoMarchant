import { assertEquals, assertRejects } from "@std/assert";
import { Catalog } from "./catalog.ts";
import { type Department, selectDepartments } from "./departments.ts";
import { DiscoverySettings, Walk } from "./discovery.ts";
import type { Listing, Pages, Reader } from "./tabs.ts";
import { Blocked } from "./interstitial.ts";
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
  readonly readers: string[] = [];

  constructor(
    private readonly pages: Record<number, string[]>,
    /** The products whose page will not load, however often it is asked for. */
    private readonly missing: readonly string[] = [],
    /** The products Amazon turns the walk away from rather than serving. */
    private readonly blocked: readonly string[] = [],
    /**
     * The last page the paginator offers. Amazon goes on serving a grid past
     * it, so the pages given may run deeper than the listings do.
     */
    private readonly lastPage = Math.max(...Object.keys(pages).map(Number)),
  ) {}

  list(_department: Department, page: number): Promise<Listing> {
    this.opened.push(page);
    return Promise.resolve({
      asins: this.pages[page] ?? [],
      more: page < this.lastPage,
    });
  }

  async each(
    asins: Iterable<string>,
    read: (asin: string, reader: Reader) => Promise<void>,
  ): Promise<void> {
    for (const asin of asins) await read(asin, this);
  }

  read(asin: string, department: Department): Promise<Product | undefined> {
    this.readers.push(asin);
    if (this.blocked.includes(asin)) {
      return Promise.reject(new Blocked("Amazon refused the page", "refused"));
    }
    if (this.missing.includes(asin)) return Promise.resolve(undefined);
    return Promise.resolve({
      asin,
      url: `https://www.amazon.com/dp/${asin}`,
      department: department.slug,
      capturedAt: "2026-08-30T00:00:00.000Z",
      title: `Product ${asin}`,
      breadcrumbs: [],
      ranked: [],
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
  listings: Listings,
  options: string[],
  body: (
    listings: Listings,
    catalog: Catalog,
    said: readonly string[],
  ) => Promise<void>,
) => {
  const dir = await Deno.makeTempDir();
  const catalog = await Catalog.open(
    dir,
    TEST_DATABASE_URL,
    new ImageStore(dir),
  );
  const said: string[] = [];
  const log = await RunLog.open(dir, "discover.log", (line) => said.push(line));
  try {
    const settings = DiscoverySettings.parse(options, DEFAULTS);
    await new Walk(settings, listings, catalog, log).of(ELECTRONICS);
    await body(listings, catalog, said);
  } finally {
    await catalog.close();
    await Deno.remove(dir, { recursive: true });
  }
};

test("a walk opens the page the last walk of the department stopped on", async () => {
  await truncate();
  // The listings run deeper than the pages given: what stops these walks is
  // --pages, not the end of the department.
  const pages = { 3: ["B000000031"], 4: ["B000000041"] };
  const listings = () => new Listings(pages, [], [], 9);

  await walking(
    listings(),
    ["--pages=2"],
    async (listings, catalog) => {
      // Nothing kept yet, so the first walk starts at the top.
      assertEquals(listings.opened, [1]);
      await catalog.keepPlace("electronics", 3);
    },
  );

  await walking(
    listings(),
    ["--pages=2"],
    async (listings, catalog) => {
      assertEquals(listings.opened, [3, 4]);
      // Both pages were read through, so the next walk opens the one after.
      assertEquals(await catalog.nextPage("electronics"), 5);
    },
  );
});

test("a walk out of products leaves the rest of the page queued", async () => {
  await truncate();
  const pages = { 1: ["B000000011", "B000000012", "B000000013"] };

  await walking(
    new Listings(pages, [], [], 9),
    ["--products=2"],
    async (_listings, catalog) => {
      assertEquals(await catalog.count("electronics"), 2);
      // The page has been listed, so the walk has no reason to open it again:
      // what it did not get to is in the queue rather than on the page.
      assertEquals(await catalog.nextPage("electronics"), 2);
      assertEquals(await catalog.unread("electronics"), ["B000000013"]);
    },
  );
});

test("a walk reads what an earlier one listed and never got to", async () => {
  await truncate();
  const first = { 1: ["B000000011", "B000000012", "B000000013"] };

  await walking(
    new Listings(first, [], [], 9),
    ["--products=1"],
    () => Promise.resolve(),
  );

  // Amazon has re-ranked the department since: the two products the first
  // walk left unread are nowhere in the listings the second one is served.
  const second = { 1: ["B000000021"], 2: ["B000000022"] };
  await walking(
    new Listings(second, [], [], 9),
    ["--pages=1"],
    async (listings, catalog) => {
      // The queue is read first, and in the order the listings ranked it;
      // then the walk carries on listing where the first one stopped.
      assertEquals(listings.readers, [
        "B000000012",
        "B000000013",
        "B000000022",
      ]);
      assertEquals(await catalog.unread("electronics"), []);
    },
  );
});

test("a walk gives up on a listing whose page will not load", async () => {
  await truncate();
  const pages = { 1: ["B000000011"] };
  const dead = ["B000000011"];

  for (let walk = 1; walk <= 3; walk++) {
    await walking(
      new Listings(pages, dead),
      ["--pages=1"],
      () => Promise.resolve(),
    );
  }

  // Three walks have asked for it and been given nothing, so a fourth reads
  // past it rather than opening it ahead of everything else again.
  await walking(
    new Listings(pages, dead),
    ["--pages=1"],
    (listings) => {
      assertEquals(listings.readers, []);
      return Promise.resolve();
    },
  );

  // A restart is what asks again.
  await walking(
    new Listings(pages, dead),
    ["--pages=1", "--restart"],
    (listings) => {
      assertEquals(listings.readers, ["B000000011"]);
      return Promise.resolve();
    },
  );
});

test("a walk that reads a page through steps over it", async () => {
  await truncate();
  const pages = { 1: ["B000000011"], 2: ["B000000021"] };

  await walking(
    new Listings(pages),
    ["--pages=1"],
    async (_listings, catalog) => {
      assertEquals(await catalog.nextPage("electronics"), 2);
    },
  );
});

test("a walk to the end of the listings forgets where it was", async () => {
  await truncate();

  await walking(
    // The paginator offers two pages and greys out "Next" on the second,
    // which is how the listings end.
    new Listings({ 1: ["B000000011"], 2: ["B000000021"] }),
    [],
    async (listings, catalog) => {
      assertEquals(listings.opened, [1, 2]);
      // So the next walk starts at the top, where a listing puts what it has
      // newly ranked.
      assertEquals(await catalog.nextPage("electronics"), 1);
    },
  );
});

test("a listing page that ranks nothing leaves the walk where it was", async () => {
  await truncate();

  await walking(
    // The paginator offers a page 2, and page 2 comes back with nothing on
    // it. That is not the end of the listings — the paginator is what says
    // that — but a page Amazon would not draw.
    new Listings({ 1: ["B000000011"] }, [], [], 2),
    [],
    async (listings, catalog) => {
      assertEquals(listings.opened, [1, 2]);
      // So the place is kept: the next walk asks for page 2 again rather than
      // taking the department for one that has been read to the end.
      assertEquals(await catalog.nextPage("electronics"), 2);
    },
  );
});

test("a walk stops on a block rather than holding it against the product", async () => {
  await truncate();
  const pages = { 1: ["B000000011", "B000000012"] };

  await assertRejects(
    () =>
      walking(
        new Listings(pages, [], ["B000000011"]),
        [],
        () => Promise.resolve(),
      ),
    Blocked,
  );

  // A page Amazon refused says nothing about the product behind it, so the
  // product keeps its place in the queue and the next walk asks again.
  await walking(
    new Listings(pages),
    [],
    async (listings, catalog) => {
      assertEquals(listings.readers, ["B000000011", "B000000012"]);
      assertEquals(await catalog.count("electronics"), 2);
    },
  );
});

test("a restart walks the department from the top again", async () => {
  await truncate();
  const pages = { 1: ["B000000011"], 5: ["B000000051"] };

  await walking(
    new Listings(pages),
    ["--pages=1"],
    async (_listings, catalog) => {
      await catalog.keepPlace("electronics", 5);
    },
  );

  await walking(new Listings(pages), ["--pages=1", "--restart"], (listings) => {
    assertEquals(listings.opened, [1]);
    return Promise.resolve();
  });
});

test("a walk spends its budget on products, not on pages that will not load", async () => {
  await truncate();
  const pages = { 1: ["B000000011", "B000000012", "B000000013"] };

  await walking(
    new Listings(pages, ["B000000011"]),
    ["--products=2"],
    async (listings, catalog) => {
      // The first would not load, so it costs the budget nothing: the two
      // products asked for are the two that were read.
      assertEquals(listings.readers, [
        "B000000011",
        "B000000012",
        "B000000013",
      ]);
      assertEquals(await catalog.count("electronics"), 2);
    },
  );
});

test("a refresh reads the pages it lists, not the queue", async () => {
  await truncate();
  const pages = { 1: ["B000000011", "B000000012"] };

  await walking(
    new Listings(pages),
    ["--products=1", "--pages=1"],
    () => Promise.resolve(),
  );

  // A refresh is there to read known products again, so it covers the page it
  // was asked for rather than only what the first walk never got to.
  await walking(
    new Listings(pages),
    ["--refresh", "--pages=1"],
    (listings) => {
      assertEquals(listings.readers, ["B000000011", "B000000012"]);
      return Promise.resolve();
    },
  );
});

test("only a queue an earlier walk left behind is reported as one", async () => {
  await truncate();
  const pages = { 1: ["B000000011", "B000000012"] };

  // The first walk queues page 1 itself, so nothing was left for it.
  await walking(
    new Listings(pages),
    ["--pages=1", "--products=1"],
    (_listings, _catalog, said) => {
      assertEquals(said.filter((line) => line.includes("earlier walk")), []);
      return Promise.resolve();
    },
  );

  // The product it had no budget for is what the next walk picks up.
  await walking(
    new Listings(pages),
    ["--pages=1"],
    (_listings, _catalog, said) => {
      assertEquals(
        said.filter((line) => line.includes("earlier walk")),
        ["  1 queued by an earlier walk"],
      );
      return Promise.resolve();
    },
  );
});

test("a walk stops at the last page the listings offer", async () => {
  await truncate();
  const pages = {
    1: ["B000000011"],
    2: ["B000000021"],
    3: ["B000000031"],
  };

  await walking(
    // Amazon's paginator offers two pages. It goes on serving a grid past the
    // last of them — recycled tiles, and a fresh one now and again — so a
    // page that ranks products is no sign there is a page to rank them.
    new Listings(pages, [], [], 2),
    [],
    async (listings, catalog) => {
      assertEquals(listings.opened, [1, 2]);
      // The listings are listed out, so the next walk starts at the top.
      assertEquals(await catalog.nextPage("electronics"), 1);
    },
  );
});
