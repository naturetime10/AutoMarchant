import { assertEquals } from "@std/assert";
import { refused } from "./interstitial.ts";

Deno.test("a status Amazon will not serve a page with is a block", () => {
  // What a walk reading too quickly is answered with, whatever the page it is
  // handed then draws.
  assertEquals(refused(503), true);
  assertEquals(refused(500), true);
  assertEquals(refused(429), true);
});

Deno.test("an answer about the page itself is not a block", () => {
  assertEquals(refused(200), false);
  // A delisted product is entitled to a 404: read as a block it would stop a
  // whole run over one dead ASIN.
  assertEquals(refused(404), false);
  assertEquals(refused(undefined), false);
});
