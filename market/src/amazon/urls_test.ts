import { assertEquals } from "@std/assert";
import { AmazonUrls } from "./urls.ts";

const urls = new AmazonUrls();

Deno.test("a department lists its products page by page", () => {
  assertEquals(
    urls.department("172282"),
    "https://www.amazon.com/s?rh=n%3A172282&fs=true",
  );
  assertEquals(
    urls.department("172282", 3),
    "https://www.amazon.com/s?rh=n%3A172282&fs=true&page=3",
  );
});

Deno.test("a product page keys off its ASIN", () => {
  assertEquals(
    urls.product("B088NRLMPV"),
    "https://www.amazon.com/dp/B088NRLMPV",
  );
});

Deno.test("a different marketplace origin carries through", () => {
  const uk = new AmazonUrls("https://www.amazon.co.uk");
  assertEquals(
    uk.product("B088NRLMPV"),
    "https://www.amazon.co.uk/dp/B088NRLMPV",
  );
});
