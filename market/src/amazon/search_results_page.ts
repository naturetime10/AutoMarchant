import type { Page } from "playwright";

const RESULT = "div[data-component-type='s-search-result'][data-asin]";

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

  /** The ASINs on screen, in the order Amazon ranked them. */
  asins(): Promise<string[]> {
    return this.page.evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)]
          .map((tile) => tile.getAttribute("data-asin") ?? "")
          .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)),
      RESULT,
    );
  }
}
