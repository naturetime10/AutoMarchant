/** Builds the Amazon URLs the discovery walk visits, for one marketplace. */
export class AmazonUrls {
  constructor(private readonly origin = "https://www.amazon.com") {}

  /**
   * Every product in a department, page by page. `fs=true` is what forces the
   * search grid: without it a bare node redirects to the department's
   * merchandising landing page, which ranks nothing.
   */
  department(node: string, page = 1): string {
    const params = new URLSearchParams({ rh: `n:${node}`, fs: "true" });
    if (page > 1) params.set("page", String(page));
    return `${this.origin}/s?${params}`;
  }

  product(asin: string): string {
    return `${this.origin}/dp/${asin}`;
  }
}
