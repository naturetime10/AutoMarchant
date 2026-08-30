import { assertEquals } from "@std/assert";
import {
  asinFromUrl,
  cleanText,
  parseCount,
  parseDate,
  parseMoney,
  parseRating,
} from "./parse.ts";

Deno.test("cleanText collapses whitespace and drops direction marks", () => {
  assertEquals(cleanText("‎ Product  Dimensions \n"), "Product Dimensions");
  assertEquals(cleanText(null), "");
});

Deno.test("parseCount reads the number out of a phrase", () => {
  assertEquals(parseCount("12,345 ratings"), 12345);
  assertEquals(parseCount("1,234 answered questions"), 1234);
  assertEquals(parseCount("3 votes"), 3);
  assertEquals(parseCount("no numbers here"), undefined);
});

Deno.test("parseCount spells out the single-vote case Amazon words", () => {
  assertEquals(parseCount("One person found this helpful"), 1);
  assertEquals(parseCount("23 people found this helpful"), 23);
});

Deno.test("parseRating reads the stars out of five", () => {
  assertEquals(parseRating("4.5 out of 5 stars"), 4.5);
  assertEquals(parseRating("5.0 out of 5 stars"), 5);
  assertEquals(parseRating(undefined), undefined);
});

Deno.test("parseMoney splits the amount from its currency", () => {
  assertEquals(parseMoney("$1,299.00"), {
    amount: 1299,
    currency: "USD",
    text: "$1,299.00",
  });
  assertEquals(parseMoney("£12.99"), {
    amount: 12.99,
    currency: "GBP",
    text: "£12.99",
  });
  assertEquals(parseMoney("12.99"), { amount: 12.99, text: "12.99" });
  assertEquals(parseMoney("Currently unavailable"), undefined);
});

Deno.test("parseDate reads the day out of the line a review dates itself by", () => {
  assertEquals(
    parseDate("Reviewed in the United States on May 1, 2024"),
    "2024-05-01T00:00:00.000Z",
  );
  assertEquals(
    parseDate("Reviewed in the United Kingdom on 1 May 2024"),
    "2024-05-01T00:00:00.000Z",
  );
  assertEquals(
    parseDate("Reviewed in Canada on Sept. 12, 2023"),
    "2023-09-12T00:00:00.000Z",
  );
  assertEquals(parseDate("Reviewed in the United States"), undefined);
  assertEquals(
    parseDate("Reviewed in the United States on Maybe 1, 2024"),
    undefined,
  );
  assertEquals(parseDate(null), undefined);
});

Deno.test("asinFromUrl finds the identifier in every product link shape", () => {
  assertEquals(
    asinFromUrl("https://www.amazon.com/Anker-Cable/dp/B088NRLMPV/ref=sr_1_1"),
    "B088NRLMPV",
  );
  assertEquals(asinFromUrl("/gp/product/B07XYZ1234?psc=1"), "B07XYZ1234");
  assertEquals(
    asinFromUrl("https://www.amazon.com/product-reviews/B088NRLMPV"),
    "B088NRLMPV",
  );
  assertEquals(asinFromUrl("https://www.amazon.com/s?k=cable"), undefined);
});
