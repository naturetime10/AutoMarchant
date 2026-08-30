import type { Page } from "playwright";

/**
 * The "Continue shopping" gate: a single button where the listing should be.
 * The button carries its label in `alt`, and sits in the form that older
 * variants of the page submit through.
 */
const CONTINUE = [
  "button[alt='Continue shopping']",
  "form[action*='/errors/validateCaptcha'] button[type='submit']",
  "button:has-text('Continue shopping')",
].join(", ");

/**
 * The 503 page — "Sorry! Something went wrong!", a search box, and one of the
 * dogs of Amazon. Every link on it is tagged cs_503, which is what tells it
 * apart from a real page that happens to be empty.
 */
const UNAVAILABLE = "a[href*='cs_503'], img[alt='Dogs of Amazon']";

/** Whichever page Amazon served in place of the one asked for. */
export type Block = "continue-shopping" | "unavailable" | "refused" | "none";

/** What each block is called in the log. */
export const BLOCK_REASON: Record<Exclude<Block, "none">, string> = {
  "continue-shopping": 'Amazon served its "Continue shopping" gate',
  "unavailable": "Amazon served its 503 page",
  "refused": "Amazon refused the page",
};

/**
 * Amazon serving something other than the page asked for, however often it is
 * asked for. It says nothing about the page behind it, so a walk that meets
 * one stops rather than writing off what it could not read.
 */
export class Blocked extends Error {}

/**
 * The statuses Amazon answers a walk it will not serve with: 503 when it
 * wants one to slow down, 429 when it says as much outright. A 404 is not
 * among them — that is an answer about the page rather than about the walk,
 * and a delisted product is entitled to one.
 */
export function refused(status?: number): boolean {
  return status !== undefined && (status === 429 || status >= 500);
}

/**
 * The pages Amazon serves in place of the one asked for when it wants a walk
 * to slow down. Left unrecognized they read as an empty department — nothing
 * renders, so the walk records no products and moves on as though there were
 * none.
 */
export class Interstitial {
  constructor(private readonly page: Page) {}

  /**
   * Which block is on screen, if the page asked for arrived at all. A page
   * refused carries no marker of its own when Amazon answers with the
   * storefront instead of its 503 page — the same throttle, dressed as an
   * ordinary page — so the status it was answered with is read as well.
   */
  async block(status?: number): Promise<Block> {
    if (await this.has(CONTINUE)) return "continue-shopping";
    if (await this.has(UNAVAILABLE)) return "unavailable";
    if (refused(status)) return "refused";
    return "none";
  }

  /**
   * Clicks through a gate that offers a way back. A refusal offers none —
   * it clears with time rather than with a click — so this leaves it alone.
   */
  async dismiss(block: Block): Promise<void> {
    if (block !== "continue-shopping") return;
    await this.page.locator(CONTINUE).first().click();
    await this.page.waitForLoadState("domcontentloaded");
  }

  private has(selector: string): Promise<boolean> {
    return this.page.locator(selector).count().then((n) => n > 0).catch(() =>
      false
    );
  }
}
