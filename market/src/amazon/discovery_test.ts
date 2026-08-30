import { assertEquals, assertThrows } from "@std/assert";
import { DEPARTMENTS } from "./departments.ts";
import { DiscoverySettings } from "./discovery.ts";

Deno.test("settings walk every department and every page by default", () => {
  const settings = DiscoverySettings.parse([], "artifacts");

  assertEquals(settings.departments.length, DEPARTMENTS.length);
  assertEquals(settings.maxPages, Number.POSITIVE_INFINITY);
  assertEquals(settings.maxProducts, Number.POSITIVE_INFINITY);
  assertEquals(settings.outputDir, "artifacts/catalog");
});

Deno.test("settings narrow the walk to the flags given", () => {
  const settings = DiscoverySettings.parse(
    [
      "--departments=books,electronics",
      "--pages=2",
      "--products=10",
      "--pause=0",
    ],
    "artifacts",
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
    DiscoverySettings.parse(["--out=/tmp/catalog"], "artifacts").outputDir,
    "/tmp/catalog",
  );
});

Deno.test("settings reject a flag that is not a number", () => {
  assertThrows(
    () => DiscoverySettings.parse(["--pages=lots"], "artifacts"),
    Error,
    "--pages",
  );
  assertThrows(
    () => DiscoverySettings.parse(["--products=0"], "artifacts"),
    Error,
    "--products",
  );
});

Deno.test("settings reject an unknown flag rather than ignoring it", () => {
  assertThrows(
    () => DiscoverySettings.parse(["--everything"], "artifacts"),
    Error,
    "--everything",
  );
});
