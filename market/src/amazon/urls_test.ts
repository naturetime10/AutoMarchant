import { assertEquals } from "@std/assert";
import { AmazonUrls } from "./urls.ts";

const urls = new AmazonUrls();

Deno.test("search encodes the query and stays on page one by default", () => {
  assertEquals(
    urls.search("usb c cable"),
    "https://www.amazon.com/s?k=usb+c+cable",
  );
});

Deno.test("search scopes to a browse node and paginates", () => {
  assertEquals(
    urls.search("cable", { node: "172282", page: 2 }),
    "https://www.amazon.com/s?k=cable&rh=n%3A172282&page=2",
  );
});

Deno.test("charts default to every category and accept a slug", () => {
  assertEquals(
    urls.chart("bestsellers"),
    "https://www.amazon.com/gp/bestsellers/",
  );
  assertEquals(
    urls.chart("movers-and-shakers", "electronics"),
    "https://www.amazon.com/gp/movers-and-shakers/electronics/",
  );
});

Deno.test("product, review, and seller pages key off their identifier", () => {
  assertEquals(
    urls.product("B088NRLMPV"),
    "https://www.amazon.com/dp/B088NRLMPV",
  );
  assertEquals(
    urls.reviews("B088NRLMPV"),
    "https://www.amazon.com/product-reviews/B088NRLMPV",
  );
  assertEquals(
    urls.sellerProfile("A294P4X9EWVXLJ"),
    "https://www.amazon.com/sp?seller=A294P4X9EWVXLJ",
  );
  assertEquals(
    urls.sellerStorefront("A294P4X9EWVXLJ"),
    "https://www.amazon.com/s?me=A294P4X9EWVXLJ",
  );
});

Deno.test("a different marketplace origin carries through", () => {
  const uk = new AmazonUrls("https://www.amazon.co.uk");
  assertEquals(
    uk.chart("bestsellers", "electronics"),
    "https://www.amazon.co.uk/gp/bestsellers/electronics/",
  );
});
