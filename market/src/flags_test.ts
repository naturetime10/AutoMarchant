import { assertEquals, assertThrows } from "@std/assert";
import { Flags } from "./flags.ts";

const KNOWN = ["departments", "pages", "refresh", "out"];

const flags = (...args: string[]) => new Flags(args, "discover", KNOWN);

Deno.test("flags read a value by the name it was given under", () => {
  assertEquals(flags("--out=/tmp/catalog").text("out"), "/tmp/catalog");
  assertEquals(flags().text("out"), undefined);
});

Deno.test("a flag on its own is the value", () => {
  assertEquals(flags("--refresh").given("refresh"), true);
  assertEquals(flags().given("refresh"), false);
});

Deno.test("flags read a whole number, and refuse what is not one", () => {
  assertEquals(flags("--pages=2").count("pages", 1), 2);
  assertEquals(flags().count("pages", 1), undefined);

  assertThrows(() => flags("--pages=lots").count("pages", 1), Error, "--pages");
  assertThrows(() => flags("--pages=0").count("pages", 1), Error, "--pages");
  assertThrows(() => flags("--pages").count("pages", 1), Error, "--pages");
});

Deno.test("flags read a comma-separated list", () => {
  assertEquals(flags("--departments=books,electronics").words("departments"), [
    "books",
    "electronics",
  ]);
  assertEquals(flags().words("departments"), undefined);
});

Deno.test("a flag the command does not know is refused, with those it does", () => {
  assertThrows(
    () => flags("--everything"),
    Error,
    "Unknown discover option: --everything. Try --departments, --pages, " +
      "--refresh, or --out.",
  );
});

Deno.test("a value the flag has no name is refused too", () => {
  assertThrows(() => flags("books"), Error, "Unknown discover option: books");
});

Deno.test("a flag given twice is read as the last of them", () => {
  assertEquals(
    flags("--out=/tmp/one", "--out=/tmp/two").text("out"),
    "/tmp/two",
  );
});
