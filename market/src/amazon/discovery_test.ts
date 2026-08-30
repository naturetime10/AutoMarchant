import { assertEquals, assertThrows } from "@std/assert";
import { DEPARTMENTS } from "./departments.ts";
import { DiscoverySettings } from "./discovery.ts";

const OUTPUT = "../output/market/discover";

Deno.test("settings walk every department and every page by default", () => {
  const settings = DiscoverySettings.parse([], OUTPUT);

  assertEquals(settings.departments.length, DEPARTMENTS.length);
  assertEquals(settings.maxPages, Number.POSITIVE_INFINITY);
  assertEquals(settings.maxProducts, Number.POSITIVE_INFINITY);
  assertEquals(settings.outputDir, OUTPUT);
});

Deno.test("settings narrow the walk to the flags given", () => {
  const settings = DiscoverySettings.parse(
    [
      "--departments=books,electronics",
      "--pages=2",
      "--products=10",
      "--pause=0",
    ],
    OUTPUT,
  );

  assertEquals(settings.departments.map((d) => d.slug), [
    "books",
    "electronics",
  ]);
  assertEquals(settings.maxPages, 2);
  assertEquals(settings.maxProducts, 10);
  assertEquals(settings.pauseMs, 0);
});

Deno.test("settings take an output directory of their own", () => {
  assertEquals(
    DiscoverySettings.parse(["--out=/tmp/catalog"], OUTPUT).outputDir,
    "/tmp/catalog",
  );
});

Deno.test("settings reject a flag that is not a number", () => {
  assertThrows(
    () => DiscoverySettings.parse(["--pages=lots"], OUTPUT),
    Error,
    "--pages",
  );
  assertThrows(
    () => DiscoverySettings.parse(["--products=0"], OUTPUT),
    Error,
    "--products",
  );
});

Deno.test("settings reject an unknown flag rather than ignoring it", () => {
  assertThrows(
    () => DiscoverySettings.parse(["--everything"], OUTPUT),
    Error,
    "--everything",
  );
});
