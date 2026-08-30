/** Ranked listings Amazon publishes per category, all sharing one path shape. */
export type SalesChart =
  | "bestsellers"
  | "movers-and-shakers"
  | "new-releases"
  | "most-wished-for";

/** Builds the Amazon URLs worth scraping, for one marketplace. */
export class AmazonUrls {
  constructor(private readonly origin = "https://www.amazon.com") {}

  /** Search results. Omit `page` for the first one. */
  search(
    query: string,
    { node, page }: { node?: string; page?: number } = {},
  ): string {
    const params = new URLSearchParams({ k: query });
    if (node) params.set("rh", `n:${node}`);
    if (page && page > 1) params.set("page", String(page));
    return `${this.origin}/s?${params}`;
  }

  /** A ranked chart; omit the category for the cross-site chart. */
  chart(chart: SalesChart, category?: string): string {
    return `${this.origin}/gp/${chart}/${category ? `${category}/` : ""}`;
  }

  browseNode(node: string): string {
    return `${this.origin}/b?node=${node}`;
  }

  product(asin: string): string {
    return `${this.origin}/dp/${asin}`;
  }

  reviews(asin: string): string {
    return `${this.origin}/product-reviews/${asin}`;
  }

  sellerProfile(sellerId: string): string {
    return `${this.origin}/sp?seller=${sellerId}`;
  }

  /** Everything one seller lists, as a search restricted to them. */
  sellerStorefront(sellerId: string): string {
    return `${this.origin}/s?me=${sellerId}`;
  }

  deals(): string {
    return `${this.origin}/deals`;
  }

  orderHistory(): string {
    return `${this.origin}/gp/css/order-history`;
  }

  buyAgain(): string {
    return `${this.origin}/gp/buyagain`;
  }
}
