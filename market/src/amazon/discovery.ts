import type { BrowserContext, Page } from "playwright";
import { Budget, WorkerPool } from "../concurrency.ts";
import { Catalog } from "./catalog.ts";
import {
  type Department,
  DEPARTMENTS,
  selectDepartments,
} from "./departments.ts";
import { ImageStore } from "./image_store.ts";
import { BLOCK_REASON, Interstitial } from "./interstitial.ts";
import type { Product } from "./product.ts";
import { ProductPage } from "./product_page.ts";
import { SearchResultsPage } from "./search_results_page.ts";
import type { RunLog } from "../run_log.ts";
import type { AmazonUrls } from "./urls.ts";

/** How many times a blocked page is asked for again before giving up. */
const MAX_RETRIES = 3;

/** How long to wait out the first block; each retry waits twice as long. */
const FIRST_BACKOFF_MS = 5_000;

export interface DiscoveryOptions {
  departments?: readonly Department[];
  /** Listing pages to walk per department; every one of them by default. */
  maxPages?: number;
  maxProducts?: number;
  outputDir?: string;
  databaseUrl?: string;
  /** Preview images to download per product; none when 0. */
  imageLimit?: number;
  /** Read products already in the catalog again, rather than skipping them. */
  refresh?: boolean;
  /** Walk each department from its first page, forgetting where one stopped. */
  restart?: boolean;
  /** Breathing room between product pages, so the walk stays polite. */
  pauseMs?: number;
  /** Product pages read at once, a tab each; five of them by default. */
  concurrency?: number;
}

/** What one `discover` run should cover, and where to write it. */
export class DiscoverySettings {
  readonly departments: readonly Department[];
  readonly maxPages: number;
  readonly maxProducts: number;
  readonly outputDir: string;
  readonly databaseUrl: string;
  readonly imageLimit: number;
  readonly refresh: boolean;
  readonly restart: boolean;
  readonly pauseMs: number;
  readonly concurrency: number;

  constructor(options: DiscoveryOptions = {}) {
    this.departments = options.departments ?? DEPARTMENTS;
    this.maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
    this.maxProducts = options.maxProducts ?? Number.POSITIVE_INFINITY;
    this.outputDir = options.outputDir ?? "../output/market/discover";
    this.databaseUrl = options.databaseUrl ??
      "postgresql://localhost:5432/automerchant";
    this.imageLimit = options.imageLimit ?? Number.POSITIVE_INFINITY;
    this.refresh = options.refresh ?? false;
    this.restart = options.restart ?? false;
    this.pauseMs = options.pauseMs ?? 1200;
    this.concurrency = options.concurrency ?? 5;
  }

  /** Reads the flags `main.ts discover` was given, over what .env set. */
  static parse(
    args: string[],
    defaults: { outputDir: string; databaseUrl: string; concurrency: number },
  ): DiscoverySettings {
    const options: DiscoveryOptions = { ...defaults };

    for (const arg of args) {
      const separator = arg.indexOf("=");
      const flag = separator === -1 ? arg : arg.slice(0, separator);
      const value = separator === -1 ? "" : arg.slice(separator + 1);

      switch (flag) {
        case "--departments":
          options.departments = selectDepartments(value.split(","));
          break;
        case "--pages":
          options.maxPages = wholeNumber(flag, value, 1);
          break;
        case "--products":
          options.maxProducts = wholeNumber(flag, value, 1);
          break;
        case "--out":
          options.outputDir = value;
          break;
        case "--database":
          options.databaseUrl = value;
          break;
        case "--images":
          options.imageLimit = wholeNumber(flag, value, 0);
          break;
        case "--refresh":
          options.refresh = true;
          break;
        case "--restart":
          options.restart = true;
          break;
        case "--pause":
          options.pauseMs = wholeNumber(flag, value, 0);
          break;
        case "--concurrency":
          options.concurrency = wholeNumber(flag, value, 1);
          break;
        default:
          throw new Error(
            `Unknown discover option: ${arg}. Try --departments, --pages, ` +
              "--products, --out, --database, --images, --refresh, " +
              "--restart, --pause, or --concurrency.",
          );
      }
    }
    return new DiscoverySettings(options);
  }
}

/** The listings a walk reads, and the products they rank. */
export interface Pages {
  /** The ASINs one listing page ranks, in the order Amazon ranked them. */
  list(department: Department, page: number): Promise<string[]>;

  /** Reads the products of one page, across however many readers there are. */
  each(
    asins: Iterable<string>,
    read: (asin: string, reader: Reader) => Promise<void>,
  ): Promise<void>;
}

/** Whatever a walk reads a product page with; a browser tab, in a run. */
export interface Reader {
  read(asin: string, department: Department): Promise<Product | undefined>;
}

/**
 * One `discover` run: the catalog it writes to and the tabs it reads with,
 * opened once and handed to a walk of every department the run covers.
 */
export class Discovery {
  constructor(
    private readonly context: BrowserContext,
    private readonly urls: AmazonUrls,
    private readonly settings: DiscoverySettings,
    private readonly log: RunLog,
  ) {}

  async run(): Promise<void> {
    const catalog = await Catalog.open(
      this.settings.outputDir,
      this.settings.databaseUrl,
      ImageStore.into(this.settings.outputDir, this.settings.imageLimit),
    );
    const tabs = await Tabs.open(
      this.context,
      this.settings,
      this.urls,
      this.log,
    );
    try {
      const walk = new Walk(this.settings, tabs, catalog, this.log);
      for (const department of this.settings.departments) {
        await walk.of(department);
      }
    } finally {
      // The catalog is squared with the database first; the tabs go with the
      // browser either way.
      await catalog.close();
      await tabs.close();
    }
  }
}

/**
 * One department, walked through the queue of what its listings have ranked.
 * A listing page puts every product it names into the queue; the walk reads
 * the queue, and a product leaves it only once it has been read. So a walk cut
 * short picks up on the products it saw and never got to, wherever Amazon has
 * since re-ranked them — or whether it still ranks them at all.
 */
export class Walk {
  constructor(
    private readonly settings: DiscoverySettings,
    private readonly pages: Pages,
    private readonly catalog: Catalog,
    private readonly log: RunLog,
  ) {}

  /** Walks one department: what an earlier walk queued, then what it lists. */
  async of(department: Department): Promise<void> {
    await this.log.info(`${department.name} -> ${this.catalog.label}`);

    const budget = new Budget(this.settings.maxProducts);
    // A walk asks for a product once, however many listings rank it and
    // however often the queue is read.
    const tried = new Set<string>();

    // A refresh takes its products from the pages it lists rather than from
    // the queue, so it covers the pages it was asked for.
    if (!this.settings.refresh) {
      const queued = await this.catalog.unread(department.slug);
      await this.read(department, budget, tried, queued);
    }
    await this.list(department, budget, tried);

    await this.log.info(
      `  ${department.slug}: ${budget.claimed} new, ${await this.catalog.count(
        department.slug,
      )} in total`,
    );
  }

  /** Lists page after page, reading what each one puts in the queue. */
  private async list(
    department: Department,
    budget: Budget,
    tried: Set<string>,
  ): Promise<void> {
    const first = await this.startOf(department);
    // --pages caps the pages this run lists, not the page it may reach, so a
    // resumed walk gets as many of them as a fresh one.
    const last = first + this.settings.maxPages - 1;
    if (first > 1) await this.log.info(`  listing from page ${first}`);
    let previous = "";

    for (let page = first; page <= last && !budget.spent; page++) {
      const asins = await this.pages.list(department, page);
      // Past the last page Amazon re-serves the previous one rather than 404.
      const signature = asins.join(",");
      if (asins.length === 0 || signature === previous) {
        // The listings are listed out: the next walk starts at the top, where
        // what has newly been ranked appears.
        await this.catalog.forgetPlace(department.slug);
        return;
      }
      previous = signature;

      await this.log.info(`  page ${page}: ${asins.length} products`);
      // The page is queued before a product of it is read, so the walk has no
      // reason to open the page again: whatever it does not get to now is in
      // the queue, and read by the walk after it.
      await this.catalog.listed(department.slug, page, asins);
      await this.catalog.keepPlace(department.slug, page + 1);
      const due = this.settings.refresh
        ? asins
        : await this.catalog.unread(department.slug);
      await this.read(department, budget, tried, due);
    }
  }

  /** Reads the products given, as far as the budget for new ones goes. */
  private async read(
    department: Department,
    budget: Budget,
    tried: Set<string>,
    due: readonly string[],
  ): Promise<void> {
    const queued = due.filter((asin) => !tried.has(asin));
    if (queued.length === 0) return;
    // What a walk reads before it has listed anything is what an earlier walk
    // left behind; the rest is the page just listed, which said its own size.
    if (tried.size === 0) {
      await this.log.info(`  ${queued.length} queued by an earlier walk`);
    }

    // The queue is read across every tab at once; a place is claimed before a
    // page is opened, so the cap holds however many tabs are reading, and
    // given back by a product that turns out to be one the catalog has.
    await this.pages.each(
      this.upTo(queued, budget, tried),
      async (asin, reader) => {
        if (!budget.claim()) return;
        if (!await this.capture(asin, department, reader)) budget.release();
      },
    );
  }

  /**
   * The queue, up to where the budget for new products runs out. It is handed
   * out a product at a time rather than as a list, so a budget that fills
   * while the tabs are reading stops the queue there.
   */
  private *upTo(
    queued: readonly string[],
    budget: Budget,
    tried: Set<string>,
  ): Generator<string> {
    for (const asin of queued) {
      if (budget.spent) return;
      tried.add(asin);
      yield asin;
    }
  }

  /**
   * The page this walk lists from: where the last one stopped, so a walk cut
   * short does not page its way back down the listings it has already read
   * into the queue. A restart, and a refresh — which is there to read known
   * products again — both start at the top instead.
   */
  private async startOf(department: Department): Promise<number> {
    if (this.settings.restart) await this.catalog.retryMissed(department.slug);
    if (this.settings.restart || this.settings.refresh) return 1;
    return await this.catalog.nextPage(department.slug);
  }

  /** Reads one product into the catalog; false when it added nothing. */
  private async capture(
    asin: string,
    department: Department,
    reader: Reader,
  ): Promise<boolean> {
    // A refresh updates what is known and adds a capture to its history.
    if (!this.settings.refresh && await this.catalog.has(asin)) return false;

    const product = await reader.read(asin, department);
    if (!product) {
      // A page that would not load is asked for again by the next walk, and
      // by the one after that, before the queue leaves it alone.
      await this.catalog.missed(department.slug, asin);
      return false;
    }

    await this.catalog.save(product);
    await this.log.info(`    ${asin}  ${product.title ?? "(untitled)"}`);
    return true;
  }
}

/**
 * The tabs a walk reads with. Listing pages are taken in order, so one tab
 * reads those; the products a listing ranks are independent, so every tab
 * reads them at once.
 */
class Tabs implements Pages {
  private readonly pool: WorkerPool<Tab>;

  private constructor(private readonly tabs: readonly Tab[]) {
    this.pool = new WorkerPool(tabs);
  }

  static async open(
    context: BrowserContext,
    settings: DiscoverySettings,
    urls: AmazonUrls,
    log: RunLog,
  ): Promise<Tabs> {
    const tabs: Tab[] = [];
    for (let index = 0; index < settings.concurrency; index++) {
      tabs.push(new Tab(await context.newPage(), urls, settings, log));
    }
    return new Tabs(tabs);
  }

  list(department: Department, page: number): Promise<string[]> {
    return this.tabs[0].asins(department, page);
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
class Tab implements Reader {
  private readonly results: SearchResultsPage;
  private readonly product: ProductPage;
  private readonly gate: Interstitial;

  constructor(
    private readonly page: Page,
    private readonly urls: AmazonUrls,
    private readonly settings: DiscoverySettings,
    private readonly log: RunLog,
  ) {
    this.results = new SearchResultsPage(page);
    this.product = new ProductPage(page);
    this.gate = new Interstitial(page);
  }

  /** The ASINs one listing page ranks, in the order Amazon ranked them. */
  async asins(department: Department, page: number): Promise<string[]> {
    await this.visit(this.urls.department(department.node, page));
    if (!await this.results.waitForResults()) return [];
    return await this.results.asins();
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
   * again. A block means the walk is reading too quickly, so each retry waits
   * longer than the last; one that outlasts them is raised rather than
   * returned, so a blocked walk says so instead of recording an empty
   * department.
   */
  private async visit(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });

    let backoffMs = FIRST_BACKOFF_MS;
    for (let retry = 1; retry <= MAX_RETRIES; retry++) {
      const block = await this.gate.block();
      if (block === "none") return;

      await this.log.error(
        `    ${BLOCK_REASON[block]}; waiting ${backoffMs / 1000}s and asking ` +
          `again (${retry}/${MAX_RETRIES})`,
      );
      await this.gate.dismiss(block);
      await this.page.waitForTimeout(backoffMs);
      backoffMs *= 2;
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
    }

    const block = await this.gate.block();
    if (block !== "none") {
      throw new Error(`${BLOCK_REASON[block]} for ${url}, and kept serving it`);
    }
  }
}

function wholeNumber(flag: string, value: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} takes a whole number of at least ${minimum}.`);
  }
  return parsed;
}
