import { assertEquals, assertThrows } from "@std/assert";
import { DEPARTMENTS } from "./departments.ts";
import { DiscoverySettings } from "./discovery.ts";

const DEFAULTS = {
  outputDir: "../output/market/discover",
  databaseUrl: "postgresql://localhost:5432/automerchant",
  concurrency: 16,
};

Deno.test("settings walk every department and every page by default", () => {
  const settings = DiscoverySettings.parse([], DEFAULTS);

  assertEquals(settings.departments.length, DEPARTMENTS.length);
  assertEquals(settings.maxPages, Number.POSITIVE_INFINITY);
  assertEquals(settings.maxProducts, Number.POSITIVE_INFINITY);
  assertEquals(settings.outputDir, DEFAULTS.outputDir);
  assertEquals(settings.databaseUrl, DEFAULTS.databaseUrl);
  assertEquals(settings.imageLimit, Number.POSITIVE_INFINITY);
  assertEquals(settings.refresh, false);
  assertEquals(settings.concurrency, 16);
});

Deno.test("settings narrow the walk to the flags given", () => {
  const settings = DiscoverySettings.parse(
    [
      "--departments=books,electronics",
      "--pages=2",
      "--products=10",
      "--pause=0",
    ],
    DEFAULTS,
  );

  assertEquals(settings.departments.map((d) => d.slug), [
    "books",
    "electronics",
  ]);
  assertEquals(settings.maxPages, 2);
  assertEquals(settings.maxProducts, 10);
  assertEquals(settings.pauseMs, 0);
});

Deno.test("settings cap or switch off the images downloaded", () => {
  assertEquals(DiscoverySettings.parse(["--images=3"], DEFAULTS).imageLimit, 3);
  assertEquals(DiscoverySettings.parse(["--images=0"], DEFAULTS).imageLimit, 0);
});

Deno.test("settings read a known product again when asked to refresh", () => {
  assertEquals(DiscoverySettings.parse(["--refresh"], DEFAULTS).refresh, true);
});

Deno.test("settings take an output directory of their own", () => {
  assertEquals(
    DiscoverySettings.parse(["--out=/tmp/catalog"], DEFAULTS).outputDir,
    "/tmp/catalog",
  );
});

Deno.test("settings read as many products at once as asked for", () => {
  const configured = { ...DEFAULTS, concurrency: 3 };

  assertEquals(DiscoverySettings.parse([], configured).concurrency, 3);
  // The flag wins over what config.toml set.
  assertEquals(
    DiscoverySettings.parse(["--concurrency=4"], configured).concurrency,
    4,
  );
  assertThrows(
    () => DiscoverySettings.parse(["--concurrency=0"], DEFAULTS),
    Error,
    "--concurrency",
  );
});

Deno.test("settings reject a flag that is not a number", () => {
  assertThrows(
    () => DiscoverySettings.parse(["--pages=lots"], DEFAULTS),
    Error,
    "--pages",
  );
  assertThrows(
    () => DiscoverySettings.parse(["--products=0"], DEFAULTS),
    Error,
    "--products",
  );
});

Deno.test("settings reject an unknown flag rather than ignoring it", () => {
  assertThrows(
    () => DiscoverySettings.parse(["--everything"], DEFAULTS),
    Error,
    "--everything",
  );
});
