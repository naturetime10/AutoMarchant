import type { Page } from "playwright";
import { type Product, type RawProduct, toProduct } from "./product.ts";

/** How much of a long brand module is worth keeping. */
const APLUS_LIMIT = 4000;

/**
 * Reads one product detail page. Amazon renders the same fact through several
 * layouts, so each field is read from every selector it is known to appear
 * under and whatever answers first wins; a field with no match stays absent.
 */
export class ProductPage {
  constructor(private readonly page: Page) {}

  async read(asin: string, department: string): Promise<Product> {
    return toProduct(await this.scrape(), {
      asin,
      url: this.page.url(),
      department,
      capturedAt: new Date().toISOString(),
    });
  }

  /** True once the title is on screen; false when Amazon served something else. */
  waitForProduct(timeoutMs = 20_000): Promise<boolean> {
    return this.page
      .waitForSelector("#productTitle", { timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  private scrape(): Promise<RawProduct> {
    return this.page.evaluate((aplusLimit) => {
      // Amazon inlines scripts, styles, and screen-reader prompts inside the
      // very containers it renders text in; read around them.
      const text = (element?: Element | null): string | null => {
        if (!element) return null;
        const clone = element.cloneNode(true) as Element;
        clone.querySelectorAll(
          "script, style, noscript, .a-hidden, .a-expander-prompt",
        ).forEach((noise) => noise.remove());
        return clone.textContent;
      };
      const one = (...selectors: string[]): string | null => {
        for (const selector of selectors) {
          const value = text(document.querySelector(selector));
          if (value && value.trim()) return value;
        }
        return null;
      };
      const many = (selector: string, root: ParentNode = document): string[] =>
        [...root.querySelectorAll(selector)].map((el) => el.textContent ?? "");
      const link = (selector: string): string | null =>
        (document.querySelector(selector) as HTMLAnchorElement | null)?.href ??
          null;

      // A category link names its browse node two ways: a trail links the
      // browse page (`?node=5046`), a rank links the bestseller list
      // (`/gp/bestsellers/books/5046/`). The store slug in the second is not
      // a node, so only the digits after it count.
      const browseNode = (anchor: HTMLAnchorElement): string | null =>
        anchor.href.match(/[?&]node=(\d+)/)?.[1] ??
          anchor.href.match(/\/gp\/bestsellers\/[^/]+\/(\d+)/)?.[1] ?? null;
      const linked = (selector: string, root: ParentNode = document) =>
        [...root.querySelectorAll(selector)].map((anchor) => ({
          name: text(anchor) ?? "",
          node: browseNode(anchor as HTMLAnchorElement),
        }));

      // "Best Sellers Rank" sits in a detail bullet on one layout and a
      // details row on the other, so it is found by what it says.
      const rank = [
        ...document.querySelectorAll(
          "#detailBullets_feature_div li, #prodDetails tr, " +
            "#productDetails_detailBullets_sections1 tr, " +
            "#productDetails_expanderTables_depthLeftSections tr, " +
            ".product-facts-detail",
        ),
      ].find((row) => /Best Sellers Rank/i.test(row.textContent ?? ""));

      const rows: Array<[string, string]> = [];
      // Tabular details: technical specs, "Additional Information", size charts.
      for (
        const row of document.querySelectorAll(
          "#prodDetails tr, #productDetails_feature_div tr, " +
            "#technicalSpecifications_section_1 tr, table.a-keyvalue tr",
        )
      ) {
        const key = text(row.querySelector("th, .a-span3, td:first-child"));
        const value = text(row.querySelector("td:last-child, .a-span9"));
        if (key && value) rows.push([key, value]);
      }
      // Bulleted details, where the label and value are sibling spans.
      for (
        const item of document.querySelectorAll("#detailBullets_feature_div li")
      ) {
        const spans = item.querySelectorAll("span.a-list-item > span");
        if (spans.length >= 2) {
          rows.push([spans[0].textContent ?? "", spans[1].textContent ?? ""]);
        }
      }
      // The two-column "Product details" fashion layout.
      for (const fact of document.querySelectorAll(".product-facts-detail")) {
        const key = text(fact.querySelector(".a-col-left"));
        const value = text(fact.querySelector(".a-col-right"));
        if (key && value) rows.push([key, value]);
      }

      // Twister: one row per dimension, each naming what is selected.
      const variations: Array<[string, string]> = [];
      for (const row of document.querySelectorAll("[id^='variation_']")) {
        const label = text(row.querySelector("label, .a-form-label"));
        const selection = text(
          row.querySelector(".selection, .a-dropdown-prompt"),
        );
        if (label && selection) variations.push([label, selection]);
      }

      const measurements: Array<[string, string]> = [];
      for (
        const row of document.querySelectorAll(
          "#sizeChart tr, .size-chart-table tr, table[id*='izeChart'] tr",
        )
      ) {
        const cells = many("th, td", row);
        if (cells.length >= 2) measurements.push([cells[0], cells[1]]);
      }

      const questions: RawProduct["questions"] = [];
      for (
        const link of document.querySelectorAll(
          "a[href*='/ask/questions/'], .askteamcanvas a[data-ask-qid]",
        )
      ) {
        const block = link.closest(".a-fixed-left-grid, .a-section");
        questions.push({
          question: link.textContent ?? "",
          answer: text(block?.querySelector(".askLongText, .a-col-right span")),
          votes: text(block?.querySelector(".vote-count, .askVoteCount")),
        });
      }

      const reviews: RawProduct["reviews"] = [];
      for (const review of document.querySelectorAll("[data-hook='review']")) {
        reviews.push({
          title: text(
            review.querySelector(
              "[data-hook='reviewTitle'], [data-hook='review-title']",
            ),
          ),
          author: text(review.querySelector(".a-profile-name")),
          ratingText: text(
            review.querySelector(
              "[data-hook='review-star-rating'], " +
                "[data-hook='cmps-review-star-rating'], .a-icon-alt",
            ),
          ),
          date: text(review.querySelector("[data-hook='review-date']")),
          verified: review.querySelector("[data-hook='avp-badge']") !== null,
          body: text(
            review.querySelector(
              "[data-hook='reviewText'], [data-hook='review-body']",
            ),
          ),
          helpfulText: text(
            review.querySelector("[data-hook='helpful-vote-statement']"),
          ),
        });
      }

      // Thumbnails carry a size token; dropping it asks for the full-size file.
      const images = [
        ...document.querySelectorAll(
          "#altImages img, #imgTagWrapperId img, #landingImage",
        ),
      ]
        .map((img) => img.getAttribute("src") ?? "")
        .filter((src) => src.startsWith("http"))
        .map((src) => src.replace(/\._[^./]+_\./, "."));

      const buybox = (attribute: string): string | null =>
        text(
          document.querySelector(
            `.tabular-buybox-text[tabular-attribute-name='${attribute}']`,
          ),
        );
      // The buy box states who sells and ships in a labelled feature block.
      const offer = (feature: string): string | null =>
        text(
          document.querySelector(
            `#${feature}InfoFeature_feature_div .offer-display-feature-text-message`,
          ),
        );

      // Amazon reuses this link for its shopping assistant on pages that no
      // longer carry a Q&A section; only the count is of interest here.
      const asked = one("#askATFLink", "a[href='#ask-btf_feature_div']");

      return {
        title: one("#productTitle"),
        byline: one("#bylineInfo", "#brand", "#bylineInfo_feature_div a"),
        bylineUrl: link("#bylineInfo"),
        breadcrumbs: linked("#wayfinding-breadcrumbs_feature_div ul li a"),
        ranked: rank ? linked("a", rank) : [],
        images,
        price: one(
          "#corePrice_feature_div .a-offscreen",
          "#corePriceDisplay_desktop_feature_div .a-offscreen",
          ".priceToPay .a-offscreen",
          "#price_inside_buybox",
          "#tp_price_block_total_price_ww .a-offscreen",
          ".a-price .a-offscreen",
        ),
        listPrice: one(
          ".basisPrice .a-offscreen",
          "span[data-a-strike='true'] .a-offscreen",
          "#listPrice",
        ),
        ratingText: one(
          "#acrPopover .a-icon-alt",
          "#averageCustomerReviews .a-icon-alt",
          "[data-hook='rating-out-of-text']",
        ),
        ratingCountText: one(
          "#acrCustomerReviewText",
          "[data-hook='total-review-count']",
        ),
        answeredQuestionsText: asked && /question/i.test(asked) ? asked : null,
        availability: one("#availability", "#outOfStock .a-color-price"),
        soldBy: offer("merchant") ?? buybox("Sold by") ??
          one("#sellerProfileTriggerId", "#merchant-info"),
        shipsFrom: offer("fulfiller") ?? buybox("Ships from"),
        sellerUrl: link("#sellerProfileTriggerId"),
        // "About this item", under the classic id and the newer one.
        features: many(
          "#feature-bullets li span.a-list-item, " +
            "#productFactsDesktopExpander li span.a-list-item",
        ),
        details: rows,
        variations,
        measurements,
        questions,
        reviews,
        description: one("#productDescription", "#bookDescription_feature_div"),
        aplus: one("#aplus", "#aplus3p_feature_div")?.slice(0, aplusLimit) ??
          null,
      };
    }, APLUS_LIMIT);
  }
}
