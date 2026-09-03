import { assertEquals } from "@std/assert";
import { Blocked, refused, unanswered } from "./interstitial.ts";

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

Deno.test("a page that never arrived is a block", () => {
  // What Amazon does to a walk it has decided is reading too much: it stops
  // answering rather than saying no, so the navigation times out.
  const timeout = new Error("page.goto: Timeout 30000ms exceeded.");
  timeout.name = "TimeoutError";
  assertEquals(unanswered(timeout), true);

  // The connection dropped part way through is the same event, seen from the
  // other end.
  assertEquals(
    unanswered(new Error("page.goto: net::ERR_CONNECTION_RESET at https://…")),
    true,
  );
});

Deno.test("an error about the page itself is not a block", () => {
  // The page arrived and the run made something of it; asking again would
  // only meet the same page.
  assertEquals(unanswered(new TypeError("selector is not a function")), false);
  assertEquals(
    unanswered(new Blocked("Amazon refused the page", "refused")),
    false,
  );
  assertEquals(unanswered("not an error at all"), false);
});
