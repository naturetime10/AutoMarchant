import type { Page } from "playwright";

const RESULT = "div[data-component-type='s-search-result'][data-asin]";

/** The page the paginator marks as the one on screen. */
const SELECTED = ".s-pagination-selected";

/** The paginator's "Next"; greyed out rather than dropped on the last page. */
const NEXT = ".s-pagination-next";
const DISABLED = "s-pagination-disabled";

/** Reads the grid of product tiles a listing page renders. */
export class SearchResultsPage {
  constructor(private readonly page: Page) {}

  /** Waits for the tiles to hydrate; false when the page has none to show. */
  waitForResults(timeoutMs = 20_000): Promise<boolean> {
    return this.page
      .waitForSelector(RESULT, { timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * The ASINs on screen, in the order Amazon ranked them. A product Amazon
   * sponsors on a page it already ranks it on has a tile either way, so the
   * ASINs are the products the page holds rather than the tiles it drew.
   */
  async asins(): Promise<string[]> {
    const ranked = await this.page.evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)]
          .map((tile) => tile.getAttribute("data-asin") ?? "")
          .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)),
      RESULT,
    );
    return [...new Set(ranked)];
  }

  /**
   * Whether Amazon offers a page after the one asked for.
   *
   * It has to be asked, because a listing page past the last one looks like a
   * listing page: Amazon caps a department at four hundred pages and then
   * goes on answering for page four thousand with a grid of its own — tiles
   * recycled from pages already walked, in an order that differs page to
   * page, under a count that has stopped making sense ("227,089-22,000 of
   * over 80,000 results"). Nothing in the grid says it is not the department.
   * The paginator does: it greys "Next" out on the last page, and past the
   * last page Amazon stops drawing it at all.
   *
   * So the paginator is read strictly. A page that does not say it is the
   * page asked for is not that page, and a walk that cannot tell where it is
   * stops rather than paging into a grid that never ends.
   */
  offersPageAfter(page: number): Promise<boolean> {
    return this.page.evaluate(
      ([selected, next, disabled, wanted]) => {
        const here = document.querySelector(selected)?.textContent?.trim();
        if (here !== wanted) return false;
        const after = document.querySelector(next);
        return after !== null && !after.classList.contains(disabled);
      },
      [SELECTED, NEXT, DISABLED, String(page)] as const,
    );
  }
}
