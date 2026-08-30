import type { Page } from "playwright";
import { type Highlight, Highlighter } from "./highlighter.ts";

/** One page of the tour, and the regions worth pointing at on it. */
export interface TourStop {
  label: string;
  url: string;
  highlights: Highlight[];
}

// Real identifiers, so the detail pages have something to show.
const SAMPLE_ASIN = "B088NRLMPV";
const SAMPLE_SELLER = "A294P4X9EWVXLJ";

/** The pages that list products or expose sales and seller information. */
export function tourStops(): TourStop[] {
  return [
    {
      label: "search results",
      url: "https://www.amazon.com/s?k=usb+c+cable",
      highlights: [
        {
          selector: "div[data-component-type='s-search-result']",
          note: "product tile",
        },
        { selector: ".s-pagination-strip", note: "pagination", limit: 1 },
      ],
    },
    {
      label: "best sellers",
      url: "https://www.amazon.com/gp/bestsellers/electronics/",
      highlights: [
        { selector: "#gridItemRoot", note: "ranked product" },
        { selector: ".zg-bdg-text", note: "rank" },
      ],
    },
    {
      label: "movers and shakers",
      url: "https://www.amazon.com/gp/movers-and-shakers/electronics/",
      highlights: [
        { selector: ".p13n-sc-uncoverable-faceout", note: "climbing product" },
      ],
    },
    {
      // /b?node= is a merchandising landing page; the node-filtered search is
      // where a category actually lists its products in a grid.
      label: "category search",
      url: "https://www.amazon.com/s?k=cable&rh=n%3A172282",
      highlights: [
        {
          selector: "div[data-component-type='s-search-result']",
          note: "product tile",
        },
        { selector: "#s-refinements", note: "category filters", limit: 1 },
      ],
    },
    {
      label: "product detail",
      url: `https://www.amazon.com/dp/${SAMPLE_ASIN}`,
      highlights: [
        { selector: "#productTitle", note: "title", limit: 1 },
        { selector: "#corePrice_feature_div", note: "price", limit: 1 },
        {
          selector: "#social-proofing-faceout-title-tk_bought",
          note: "units sold",
          limit: 1,
        },
        { selector: "#averageCustomerReviews", note: "rating", limit: 1 },
      ],
    },
    {
      label: "seller profile",
      url: `https://www.amazon.com/sp?seller=${SAMPLE_SELLER}`,
      highlights: [
        { selector: "#seller-name", note: "seller", limit: 1 },
        {
          selector: "#seller-info-feedback-summary",
          note: "feedback",
          limit: 1,
        },
      ],
    },
    {
      label: "seller storefront",
      url: `https://www.amazon.com/s?me=${SAMPLE_SELLER}`,
      highlights: [
        {
          selector: "div[data-component-type='s-search-result']",
          note: "seller's listing",
        },
      ],
    },
    {
      label: "order history",
      url: "https://www.amazon.com/gp/css/order-history",
      highlights: [
        {
          selector: ".your-orders-content-container__content",
          note: "your orders",
          limit: 1,
        },
      ],
    },
  ];
}

/** Walks the stops in a visible browser, saving a labelled screenshot each. */
export class Tour {
  private readonly highlighter: Highlighter;

  constructor(
    private readonly page: Page,
    private readonly artifactsDir: string,
    private readonly pauseMs: number,
  ) {
    this.highlighter = new Highlighter(page);
  }

  async run(stops: TourStop[]): Promise<void> {
    await Deno.mkdir(this.artifactsDir, { recursive: true });

    for (const [index, stop] of stops.entries()) {
      await this.page.goto(stop.url, { waitUntil: "domcontentloaded" });
      // Listings hydrate after load; mark them once they are on screen.
      await this.page.waitForTimeout(2500);

      const marked = await this.highlighter.mark(stop.highlights);
      const path = `${this.artifactsDir}/${
        String(index + 1).padStart(2, "0")
      }-${stop.label.replaceAll(" ", "-")}.png`;
      // Full page, so a region below the fold is still in the picture.
      await this.page.screenshot({ path, fullPage: true });

      console.log(
        `${stop.label.padEnd(20)} ${
          String(marked).padStart(3)
        } marked  ${path}`,
      );
      await this.page.waitForTimeout(this.pauseMs);
    }
  }
}
