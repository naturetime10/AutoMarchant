import {
  cleanText,
  type Money,
  parseCount,
  parseDate,
  parseMoney,
  parseRating,
} from "./parse.ts";

export type { Money };

/** What shoppers scored the product, and how many of them did. */
export interface Rating {
  average?: number;
  count?: number;
}

/** The brand storefront behind the product and the merchant filling orders. */
export interface Store {
  name?: string;
  url?: string;
  soldBy?: string;
  shipsFrom?: string;
  sellerUrl?: string;
}

export interface Review {
  title?: string;
  author?: string;
  rating?: number;
  /** ISO timestamp of the day the review was written. */
  date?: string;
  verifiedPurchase: boolean;
  body?: string;
  helpfulVotes?: number;
}

export interface Question {
  question: string;
  answer?: string;
  votes?: number;
}

/** Everything one product detail page says about the product. */
export interface Product {
  asin: string;
  url: string;
  department: string;
  /** ISO timestamp; a listing is only true as of when it was read. */
  capturedAt: string;
  title?: string;
  brand?: string;
  /** Who wrote it, on a page whose byline names contributors, not a brand. */
  author?: string;
  breadcrumbs: string[];
  images: string[];
  price?: Money;
  listPrice?: Money;
  rating: Rating;
  answeredQuestions?: number;
  availability?: string;
  store: Store;
  features: string[];
  details: Record<string, string>;
  /** The selected value of each twister dimension: colour, size, style. */
  variations: Record<string, string>;
  style?: string;
  measurements: Record<string, string>;
  stylingIdeas: string[];
  questions: Question[];
  reviews: Review[];
  description?: string;
  /** The brand's "From the manufacturer" module, when there is one. */
  aplus?: string;
}

/** A review as it reads on the page, before the numbers are picked out. */
export interface RawReview {
  title: string | null;
  author: string | null;
  ratingText: string | null;
  date: string | null;
  verified: boolean;
  body: string | null;
  helpfulText: string | null;
}

/** A product detail page as it reads, before any of it is interpreted. */
export interface RawProduct {
  title: string | null;
  byline: string | null;
  bylineUrl: string | null;
  breadcrumbs: string[];
  images: string[];
  price: string | null;
  listPrice: string | null;
  ratingText: string | null;
  ratingCountText: string | null;
  answeredQuestionsText: string | null;
  availability: string | null;
  soldBy: string | null;
  shipsFrom: string | null;
  sellerUrl: string | null;
  features: string[];
  details: Array<[string, string]>;
  variations: Array<[string, string]>;
  measurements: Array<[string, string]>;
  stylingIdeas: string[];
  questions: Array<
    { question: string; answer: string | null; votes: string | null }
  >;
  reviews: RawReview[];
  description: string | null;
  aplus: string | null;
}

/** Where a scraped page came from, and when. */
export interface ProductContext {
  asin: string;
  url: string;
  department: string;
  capturedAt: string;
}

/** Detail rows that describe how big the product is. */
const MEASUREMENT = /dimension|weight|measure|length|width|height|\bsize\b/i;

/** Reads a scraped page into the product it describes. */
export function toProduct(
  raw: RawProduct,
  context: ProductContext,
): Product {
  const details = toRecord(raw.details);
  const variations = toRecord(raw.variations);
  const { brand, author } = readByline(raw.byline);

  return {
    ...context,
    ...optional("title", cleanText(raw.title)),
    ...optional("brand", brand),
    ...optional("author", author),
    breadcrumbs: texts(raw.breadcrumbs),
    images: unique(raw.images),
    ...optionalValue("price", parseMoney(raw.price)),
    ...optionalValue("listPrice", parseMoney(raw.listPrice)),
    rating: {
      ...optionalValue("average", parseRating(raw.ratingText)),
      ...optionalValue("count", parseCount(raw.ratingCountText)),
    },
    ...optionalValue(
      "answeredQuestions",
      parseCount(raw.answeredQuestionsText),
    ),
    ...optional("availability", cleanText(raw.availability)),
    store: {
      // A book's byline links to its author, who is no storefront: with no
      // brand named, there is no store for the name or the link to belong to.
      ...optional("name", brand),
      ...optional("url", brand ? cleanText(raw.bylineUrl) : ""),
      ...optional("soldBy", cleanText(raw.soldBy)),
      ...optional("shipsFrom", cleanText(raw.shipsFrom)),
      ...optional("sellerUrl", cleanText(raw.sellerUrl)),
    },
    features: texts(raw.features),
    details,
    variations,
    ...optional("style", variations["Style"] ?? details["Style"] ?? ""),
    measurements: measurementsFrom(raw.measurements, details),
    stylingIdeas: unique(texts(raw.stylingIdeas)),
    questions: raw.questions.map((entry) => ({
      question: cleanText(entry.question),
      ...optional("answer", cleanText(entry.answer)),
      ...optionalValue("votes", parseCount(entry.votes)),
    })),
    reviews: raw.reviews.map(toReview),
    ...optional("description", cleanText(raw.description)),
    ...optional("aplus", cleanText(raw.aplus)),
  };
}

function toReview(raw: RawReview): Review {
  return {
    // The title element repeats the stars ahead of the words in some layouts.
    ...optional(
      "title",
      cleanText(raw.title).replace(/^\d+(\.\d+)? out of 5 stars\s*/i, ""),
    ),
    ...optional("author", cleanText(raw.author)),
    ...optionalValue("rating", parseRating(raw.ratingText)),
    // "Reviewed in the United States on May 1, 2024" — keep the day only.
    ...optionalValue("date", parseDate(raw.date)),
    verifiedPurchase: raw.verified,
    ...optional("body", cleanText(raw.body)),
    ...optionalValue("helpfulVotes", parseCount(raw.helpfulText)),
  };
}

/** The byline of a book, which opens with "by" or credits a contributor. */
const CONTRIBUTED =
  /^by\s|\([^)]*\b(author|editor|illustrator|translator|narrator|foreword|contributor)\b/i;
const BY = /^by\s+/i;
/** "Format: Paperback" trails the contributors on a book's byline. */
const FORMAT = /\s*\bformat:.*$/i;
/** A credit: the name up to the role it is followed by, "Jane Doe (Author)". */
const CONTRIBUTOR = /([^,;›(]+)\(([^)]*)\)/g;

/** What a byline names: the brand behind a product, or a book's author. */
export interface Byline {
  brand: string;
  author: string;
}

/**
 * A product's byline names its brand, but a book's names the people who wrote
 * it — so a book has an author where another product has a brand, and neither
 * has both.
 */
export function readByline(byline: string | null): Byline {
  const text = cleanText(byline).replace(FORMAT, "");
  return CONTRIBUTED.test(text)
    ? { brand: "", author: authorsIn(text) }
    : { brand: brandIn(text), author: "" };
}

/** "Visit the Anker Store" and "Brand: Anker" both name Anker. */
function brandIn(text: string): string {
  return cleanText(
    text.replace(/^visit the\s+/i, "")
      .replace(/\s+store$/i, "")
      .replace(/^brand:\s*/i, ""),
  );
}

/**
 * The authors among the contributors: an illustrator or a translator is
 * credited the same way and is not one. An uncredited byline is all author.
 */
function authorsIn(text: string): string {
  const credits = [...text.matchAll(CONTRIBUTOR)];
  if (credits.length === 0) return cleanText(text).replace(BY, "");
  return credits
    .filter(([, , role]) => /\bauthor\b/i.test(role))
    .map(([, name]) => cleanText(name).replace(BY, ""))
    .filter((name) => name.length > 0)
    .join(", ");
}

function measurementsFrom(
  charted: Array<[string, string]>,
  details: Record<string, string>,
): Record<string, string> {
  const measurements = toRecord(charted);
  for (const [key, value] of Object.entries(details)) {
    if (MEASUREMENT.test(key)) measurements[key] ??= value;
  }
  return measurements;
}

function toRecord(rows: Array<[string, string]>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [rawKey, rawValue] of rows) {
    const key = cleanText(rawKey).replace(/[:\s]+$/, "");
    const value = cleanText(rawValue);
    if (key && value) record[key] ??= value;
  }
  return record;
}

function texts(values: string[]): string[] {
  return values.map(cleanText).filter((value) => value.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Omits the key when the text is empty, so absent fields stay absent. */
function optional<K extends string>(
  key: K,
  value: string,
): Partial<Record<K, string>> {
  return value ? { [key]: value } as Record<K, string> : {};
}

function optionalValue<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: value } as Record<K, V>;
}
