import type { Product } from "./product.ts";

/** Joins the values of a list column into one cell. */
const LIST_SEPARATOR = " | ";

/**
 * Renders products as CSV rows, one row per product, so a run's output opens
 * in a spreadsheet. A field with structure of its own — the detail rows, the
 * reviews — is carried as JSON inside its cell rather than flattened away.
 */
export class ProductCsv {
  static readonly COLUMNS = [
    "asin",
    "url",
    "department",
    "capturedAt",
    "title",
    "brand",
    "breadcrumbs",
    "images",
    "price",
    "listPrice",
    "currency",
    "ratingAverage",
    "ratingCount",
    "answeredQuestions",
    "availability",
    "storeName",
    "storeUrl",
    "soldBy",
    "shipsFrom",
    "sellerUrl",
    "features",
    "details",
    "variations",
    "style",
    "measurements",
    "stylingIdeas",
    "questions",
    "reviews",
    "description",
    "aplus",
  ] as const;

  static header(): string {
    return `${ProductCsv.COLUMNS.join(",")}\n`;
  }

  static row(product: Product): string {
    const cells: Record<(typeof ProductCsv.COLUMNS)[number], unknown> = {
      asin: product.asin,
      url: product.url,
      department: product.department,
      capturedAt: product.capturedAt,
      title: product.title,
      brand: product.brand,
      breadcrumbs: list(product.breadcrumbs),
      images: list(product.images),
      price: product.price?.amount,
      listPrice: product.listPrice?.amount,
      currency: product.price?.currency ?? product.listPrice?.currency,
      ratingAverage: product.rating.average,
      ratingCount: product.rating.count,
      answeredQuestions: product.answeredQuestions,
      availability: product.availability,
      storeName: product.store.name,
      storeUrl: product.store.url,
      soldBy: product.store.soldBy,
      shipsFrom: product.store.shipsFrom,
      sellerUrl: product.store.sellerUrl,
      features: list(product.features),
      details: nested(product.details),
      variations: nested(product.variations),
      style: product.style,
      measurements: nested(product.measurements),
      stylingIdeas: list(product.stylingIdeas),
      questions: nested(product.questions),
      reviews: nested(product.reviews),
      description: product.description,
      aplus: product.aplus,
    };

    return `${
      ProductCsv.COLUMNS.map((column) => cell(cells[column])).join(",")
    }\n`;
  }
}

function list(values: string[]): string {
  return values.join(LIST_SEPARATOR);
}

/** Keeps a structured field readable in a cell without losing it. */
function nested(value: Record<string, unknown> | unknown[]): string {
  const empty = Array.isArray(value)
    ? value.length === 0
    : Object.keys(value).length === 0;
  return empty ? "" : JSON.stringify(value);
}

/** RFC 4180: quote a cell that holds a comma, a quote, or a line break. */
function cell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
