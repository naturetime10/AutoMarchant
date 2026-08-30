import { assertEquals } from "@std/assert";
import { type RawProduct, toProduct } from "./product.ts";

const raw: RawProduct = {
  title: "  Anker USB C Cable\n ",
  byline: "Visit the Anker Store",
  bylineUrl: "https://www.amazon.com/stores/Anker/page/1",
  breadcrumbs: ["Electronics", " Accessories ", ""],
  images: ["https://m.media-amazon.com/images/I/1.jpg"],
  price: "$12.99",
  listPrice: "$19.99",
  ratingText: "4.5 out of 5 stars",
  ratingCountText: "12,345 ratings",
  answeredQuestionsText: "1,234 answered questions",
  availability: " In Stock ",
  soldBy: "AnkerDirect",
  shipsFrom: "Amazon.com",
  sellerUrl: "https://www.amazon.com/sp?seller=A294P4X9EWVXLJ",
  features: ["Fast charging", "   "],
  details: [
    ["‎Product Dimensions", "‎6 x 4 x 1 inches; 3.2 Ounces"],
    ["Style:", "Braided"],
    ["Customer Reviews", "4.5 out of 5 stars"],
  ],
  variations: [["Color:", "Black"], ["Style:", "Braided"]],
  measurements: [["Length", "6 ft"]],
  stylingIdeas: ["Wear with a denim jacket", "Wear with a denim jacket"],
  questions: [
    { question: " Is it USB 3? ", answer: "Yes", votes: "3 votes" },
  ],
  reviews: [{
    title: "5.0 out of 5 stars Great cable",
    author: "Sam",
    ratingText: "5.0 out of 5 stars",
    date: "Reviewed in the United States on May 1, 2024",
    verified: true,
    body: "  Works well  ",
    helpfulText: "One person found this helpful",
  }],
  description: " A braided cable. ",
  aplus: "Anker quality",
};

const context = {
  asin: "B088NRLMPV",
  url: "https://www.amazon.com/dp/B088NRLMPV",
  department: "electronics",
  capturedAt: "2026-08-29T00:00:00.000Z",
};

const product = toProduct(raw, context);

Deno.test("toProduct keeps the identity of the page it came from", () => {
  assertEquals(product.asin, "B088NRLMPV");
  assertEquals(product.url, context.url);
  assertEquals(product.department, "electronics");
  assertEquals(product.capturedAt, context.capturedAt);
});

Deno.test("toProduct tidies the text Amazon renders", () => {
  assertEquals(product.title, "Anker USB C Cable");
  assertEquals(product.breadcrumbs, ["Electronics", "Accessories"]);
  assertEquals(product.features, ["Fast charging"]);
  assertEquals(product.availability, "In Stock");
  assertEquals(product.description, "A braided cable.");
  assertEquals(product.aplus, "Anker quality");
});

Deno.test("toProduct reads the brand out of the byline", () => {
  assertEquals(product.brand, "Anker");
  assertEquals(
    toProduct({ ...raw, byline: "Brand: Anker" }, context).brand,
    "Anker",
  );
  assertEquals(toProduct({ ...raw, byline: null }, context).brand, undefined);
});

Deno.test("toProduct turns prices and ratings into numbers", () => {
  assertEquals(product.price, {
    amount: 12.99,
    currency: "USD",
    text: "$12.99",
  });
  assertEquals(product.listPrice?.amount, 19.99);
  assertEquals(product.rating, { average: 4.5, count: 12345 });
  assertEquals(product.answeredQuestions, 1234);
});

Deno.test("toProduct collects who sells and ships the product", () => {
  assertEquals(product.store, {
    name: "Anker",
    url: raw.bylineUrl ?? undefined,
    soldBy: "AnkerDirect",
    shipsFrom: "Amazon.com",
    sellerUrl: raw.sellerUrl ?? undefined,
  });
});

Deno.test("toProduct keys the detail rows, without their punctuation", () => {
  assertEquals(
    product.details["Product Dimensions"],
    "6 x 4 x 1 inches; 3.2 Ounces",
  );
  assertEquals(product.details["Style"], "Braided");
});

Deno.test("toProduct picks the style out of the selected variations", () => {
  assertEquals(product.variations, { Color: "Black", Style: "Braided" });
  assertEquals(product.style, "Braided");
});

Deno.test("toProduct gathers measurements from the chart and the details", () => {
  assertEquals(product.measurements, {
    "Length": "6 ft",
    "Product Dimensions": "6 x 4 x 1 inches; 3.2 Ounces",
  });
});

Deno.test("toProduct drops repeated styling ideas", () => {
  assertEquals(product.stylingIdeas, ["Wear with a denim jacket"]);
});

Deno.test("toProduct counts the votes on an answered question", () => {
  assertEquals(product.questions, [
    { question: "Is it USB 3?", answer: "Yes", votes: 3 },
  ]);
});

Deno.test("toProduct unpacks a review into its parts", () => {
  assertEquals(product.reviews, [{
    title: "Great cable",
    author: "Sam",
    rating: 5,
    date: "May 1, 2024",
    verifiedPurchase: true,
    body: "Works well",
    helpfulVotes: 1,
  }]);
});

Deno.test("toProduct leaves absent fields out rather than guessing", () => {
  const empty = toProduct({
    ...raw,
    title: null,
    price: null,
    listPrice: null,
    ratingText: null,
    ratingCountText: null,
    answeredQuestionsText: null,
    description: null,
  }, context);

  assertEquals(empty.title, undefined);
  assertEquals(empty.price, undefined);
  assertEquals(empty.rating, {});
  assertEquals(empty.answeredQuestions, undefined);
  assertEquals(empty.description, undefined);
});

Deno.test("toProduct reads a book's author, not a storefront", () => {
  const book = toProduct({
    ...raw,
    byline: "by Amy Long (Author) Format: Paperback",
    bylineUrl: "https://www.amazon.com/stores/author/B0FFM8TWFH",
  }, context);

  assertEquals(book.author, "Amy Long");
  // The byline names a person, so it names no brand and no storefront.
  assertEquals(book.brand, undefined);
  assertEquals(book.store.name, undefined);
  assertEquals(book.store.url, undefined);
  // Who fills the order is still read from the buy box.
  assertEquals(book.store.soldBy, "AnkerDirect");
});

Deno.test("toProduct keeps the authors among a book's contributors", () => {
  const authorOf = (byline: string) =>
    toProduct({ ...raw, byline }, context).author;

  assertEquals(
    authorOf("by D. Terrence Foster MD (Author) Format: Kindle Edition"),
    "D. Terrence Foster MD",
  );
  assertEquals(
    authorOf("by Jane Doe (Author), John Smith (Author)"),
    "Jane Doe, John Smith",
  );
  assertEquals(
    authorOf("by Jane Doe (Author), John Smith (Illustrator)"),
    "Jane Doe",
  );
  assertEquals(
    authorOf("by Jane Doe (Author) › Visit Amazon's Jane Doe Page"),
    "Jane Doe",
  );
  assertEquals(authorOf("by Jane Doe"), "Jane Doe");
  assertEquals(authorOf("Visit the Anker Store"), undefined);
});
