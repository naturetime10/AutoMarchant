/** Turns the strings Amazon renders on a page into the values behind them. */

const CURRENCIES: Record<string, string> = {
  "$": "USD",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  "₹": "INR",
};

/** An amount and the currency it was written in. */
export interface Money {
  amount: number;
  currency?: string;
  text: string;
}

/** Collapses whitespace and drops the direction marks Amazon sprinkles in. */
export function cleanText(value?: string | null): string {
  return (value ?? "")
    .replace(/[‎‏؜]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first number in a phrase: "12,345 ratings" becomes 12345. */
export function parseCount(value?: string | null): number | undefined {
  const text = cleanText(value);
  const digits = text.match(/\d[\d,]*/);
  if (digits) return Number(digits[0].replaceAll(",", ""));
  // Amazon spells out the singular: "One person found this helpful".
  return /\bone\b/i.test(text) ? 1 : undefined;
}

/** The stars in "4.5 out of 5 stars". */
export function parseRating(value?: string | null): number | undefined {
  const match = cleanText(value).match(/(\d+(?:\.\d+)?)\s*out of/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * The amount and currency in a price. Written for the dot-decimal
 * marketplaces; a comma-decimal locale would need its own reading.
 */
export function parseMoney(value?: string | null): Money | undefined {
  const text = cleanText(value);
  const digits = text.match(/\d[\d,]*(?:\.\d+)?/);
  if (!digits) return undefined;

  const symbol = text.match(/[^\s\d.,]+/)?.[0];
  const currency = symbol ? CURRENCIES[symbol] ?? symbol : undefined;
  return {
    amount: Number(digits[0].replaceAll(",", "")),
    ...(currency ? { currency } : {}),
    text,
  };
}

/** The months as Amazon writes them, in full and in the short forms. */
const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sept", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];

/** "1 May 2024", as the marketplaces outside the United States date a review. */
const DAY_FIRST = /\b(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})\b/;
/** "May 1, 2024". */
const MONTH_FIRST = /\b([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\b/;

/**
 * The day a line names, as an ISO timestamp: "Reviewed in the United States on
 * May 1, 2024" becomes 2024-05-01. A page dates a review to the day, so the
 * moment it answers with is that day's midnight, UTC.
 */
export function parseDate(value?: string | null): string | undefined {
  const text = cleanText(value);
  const dayFirst = text.match(DAY_FIRST);
  const monthFirst = !dayFirst ? text.match(MONTH_FIRST) : null;
  const [day, month, year] = dayFirst
    ? [dayFirst[1], dayFirst[2], dayFirst[3]]
    : monthFirst
    ? [monthFirst[2], monthFirst[1], monthFirst[3]]
    : [];
  if (!month) return undefined;

  const index = MONTHS.findIndex((names) =>
    names.includes(month.toLowerCase())
  );
  if (index < 0) return undefined;

  return new Date(Date.UTC(Number(year), index, Number(day))).toISOString();
}

/** The ASIN in any of the link shapes Amazon uses for a product. */
export function asinFromUrl(url: string): string | undefined {
  return url.match(
    /\/(?:dp|gp\/product|gp\/aw\/d|product-reviews)\/([A-Z0-9]{10})/,
  )?.[1];
}
