import type { BrowserContext, Page } from "playwright";
import { WorkerPool } from "../concurrency.ts";
import type { Diagnostics } from "./diagnostics.ts";
import type { Department } from "./departments.ts";
import {
  type Block,
  BLOCK_REASON,
  Blocked,
  Interstitial,
  unanswered,
} from "./interstitial.ts";
import type { Product } from "./product.ts";
import { ProductPage } from "./product_page.ts";
import { SearchResultsPage } from "./search_results_page.ts";
import type { RunLog } from "../run_log.ts";
import type { AmazonUrls } from "./urls.ts";

/**
 * How many times a blocked page is asked for again before giving up. The
 * doubling below turns this into how long a walk will wait out a block: five
 * retries wait a little over two and a half minutes in total, and a walk
 * Amazon has gone quiet on spends thirty seconds timing out before each of
 * them, so it holds on for about five minutes before it stops. That is longer
 * than the throttles seen so far, which have run a minute or two.
 */
const MAX_RETRIES = 5;

/** How long to wait out the first block; each retry waits twice as long. */
const FIRST_BACKOFF_MS = 5_000;

/** What a run reading Amazon's pages needs of its settings. */
export interface ReadingSettings {
  /** Breathing room between pages, so a run stays polite. */
  readonly pauseMs: number;
  /** Product pages read at once, a browser tab each. */
  readonly concurrency: number;
}

/** Whatever a run reads a product page with; a browser tab, in a run. */
export interface Reader {
  read(asin: string, department: Department): Promise<Product | undefined>;
}

/** The product pages a run reads, across however many readers there are. */
export interface Readers {
  each(
    asins: Iterable<string>,
    read: (asin: string, reader: Reader) => Promise<void>,
  ): Promise<void>;
}

/** What one listing page came back with. */
export interface Listing {
  /** The ASINs it ranked, in the order Amazon ranked them. */
  asins: string[];
  /**
   * Whether Amazon offers a page after this one. It is the paginator's
   * answer, not a guess from what the page drew: past its last page Amazon
   * goes on serving a grid of recycled tiles rather than saying it has run
   * out, so a page full of products is no sign there is another.
   */
  more: boolean;
}

/** The listings a walk reads, and the products they rank. */
export interface Pages extends Readers {
  /** One listing page: what it ranked, and whether there is another. */
  list(department: Department, page: number): Promise<Listing>;
}

/**
 * The tabs a run reads with. Listing pages are taken in order, so one tab
 * reads those; the products a listing ranks are independent, so every tab
 * reads them at once.
 */
export class Tabs implements Pages {
  private readonly pool: WorkerPool<Tab>;

  private constructor(private readonly tabs: readonly Tab[]) {
    this.pool = new WorkerPool(tabs);
  }

  static async open(
    context: BrowserContext,
    settings: ReadingSettings,
    urls: AmazonUrls,
    log: RunLog,
    diagnostics: Diagnostics,
  ): Promise<Tabs> {
    const tabs: Tab[] = [];
    for (let index = 0; index < settings.concurrency; index++) {
      tabs.push(
        new Tab(await context.newPage(), urls, settings, log, diagnostics),
      );
    }
    return new Tabs(tabs);
  }

  list(department: Department, page: number): Promise<Listing> {
    return this.tabs[0].listing(department, page);
  }

  each(
    asins: Iterable<string>,
    read: (asin: string, reader: Reader) => Promise<void>,
  ): Promise<void> {
    return this.pool.run(asins, read);
  }

  async close(): Promise<void> {
    await Promise.all(this.tabs.map((tab) => tab.close()));
  }
}

/** One tab of the browser, reading whatever page it is pointed at. */
export class Tab implements Reader {
  private readonly results: SearchResultsPage;
  private readonly product: ProductPage;
  private readonly gate: Interstitial;

  constructor(
    private readonly page: Page,
    private readonly urls: AmazonUrls,
    private readonly settings: ReadingSettings,
    private readonly log: RunLog,
    private readonly diagnostics: Diagnostics,
  ) {
    this.results = new SearchResultsPage(page);
    this.product = new ProductPage(page);
    this.gate = new Interstitial(page);
  }

  /** One listing page: what it ranked, and whether there is another. */
  async listing(department: Department, page: number): Promise<Listing> {
    await this.visit(this.urls.department(department.node, page));
    if (!await this.results.waitForResults()) return { asins: [], more: false };
    return {
      asins: await this.results.asins(),
      more: await this.results.offersPageAfter(page),
    };
  }

  /** Reads one product; a page that will not load costs that product only. */
  async read(
    asin: string,
    department: Department,
  ): Promise<Product | undefined> {
    try {
      await this.visit(this.urls.product(asin));
      if (!await this.product.waitForProduct()) {
        await this.log.error(`    ${asin}  skipped: no product page`);
        return undefined;
      }

      const product = await this.product.read(asin, department.slug);
      await this.page.waitForTimeout(this.settings.pauseMs);
      return product;
    } catch (error) {
      // A page Amazon refused says nothing about the product behind it, so
      // the run stops on it rather than spending one of the product's tries.
      if (error instanceof Blocked) throw error;
      await this.log.error(
        `    ${asin}  skipped: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return undefined;
    }
  }

  close(): Promise<void> {
    return this.page.close();
  }

  /**
   * Opens a page, clearing whatever Amazon serves in its place and asking
   * again. A block means the run is reading too quickly, so each retry waits
   * longer than the last; one that outlasts them is raised rather than
   * returned, so a blocked run says so instead of recording an empty
   * department.
   */
  private async visit(url: string): Promise<void> {
    let block = await this.open(url);

    let backoffMs = FIRST_BACKOFF_MS;
    for (let retry = 1; retry <= MAX_RETRIES; retry++) {
      if (block === "none") return;

      await this.log.error(
        `    ${BLOCK_REASON[block]}; waiting ${backoffMs / 1000}s and asking ` +
          `again (${retry}/${MAX_RETRIES})`,
      );
      await this.gate.dismiss(block);
      await this.page.waitForTimeout(backoffMs);
      backoffMs *= 2;
      block = await this.open(url);
    }

    if (block !== "none") {
      // The tabs are closed as the run unwinds, so what Amazon served is
      // recorded here, while the page that would not come is still open.
      await this.diagnostics.save(this.page);
      throw new Blocked(
        `${BLOCK_REASON[block]} for ${url}, ${MAX_RETRIES + 1} times over`,
      );
    }
  }

  /**
   * Asks for a page once: which block it met, if any. A navigation that never
   * came back is one of them rather than an error of its own — Amazon turning
   * a walk away by going quiet — so it is waited out and asked for again like
   * the blocks that do render.
   */
  private async open(url: string): Promise<Block> {
    try {
      const answer = await this.page.goto(url, {
        waitUntil: "domcontentloaded",
      });
      return await this.gate.block(answer?.status());
    } catch (error) {
      if (unanswered(error)) return "unanswered";
      throw error;
    }
  }
}
