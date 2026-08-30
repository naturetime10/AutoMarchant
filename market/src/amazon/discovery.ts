import type { BrowserContext, Page } from "playwright";
import { Budget, WorkerPool } from "../concurrency.ts";
import { Catalog } from "./catalog.ts";
import {
  type Department,
  DEPARTMENTS,
  selectDepartments,
} from "./departments.ts";
import { ImageStore } from "./image_store.ts";
import type { Product } from "./product.ts";
import { ProductPage } from "./product_page.ts";
import { SearchResultsPage } from "./search_results_page.ts";
import type { RunLog } from "../run_log.ts";
import type { AmazonUrls } from "./urls.ts";

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
        case "--pause":
          options.pauseMs = wholeNumber(flag, value, 0);
          break;
        case "--concurrency":
          options.concurrency = wholeNumber(flag, value, 1);
          break;
        default:
          throw new Error(
            `Unknown discover option: ${arg}. Try --departments, --pages, ` +
              "--products, --out, --database, --images, --refresh, --pause, " +
              "or --concurrency.",
          );
      }
    }
    return new DiscoverySettings(options);
  }
}

/**
 * Walks the storefront department by department: each listing page in turn,
 * then each product it ranks, writing what every detail page says.
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
      for (const department of this.settings.departments) {
        await this.walk(department, tabs, catalog);
      }
    } finally {
      // The catalog is squared with the database first; the tabs go with the
      // browser either way.
      await catalog.close();
      await tabs.close();
    }
  }

  private async walk(
    department: Department,
    tabs: Tabs,
    catalog: Catalog,
  ): Promise<void> {
    await this.log.info(`${department.name} -> ${catalog.label}`);

    const budget = new Budget(this.settings.maxProducts);
    let previous = "";

    for (let page = 1; page <= this.settings.maxPages; page++) {
      const asins = await tabs.list(department, page);
      // Past the last page Amazon re-serves the previous one rather than 404.
      const signature = asins.join(",");
      if (asins.length === 0 || signature === previous) break;
      previous = signature;

      await this.log.info(`  page ${page}: ${asins.length} products`);
      // The products a page ranks are read across every tab at once; a place
      // is claimed before a page is opened, so the cap holds however many
      // tabs are reading.
      await tabs.each(asins, async (asin, tab) => {
        if (!budget.claim()) return;
        if (!await this.capture(asin, department, tab, catalog)) {
          budget.release();
        }
      });
      if (budget.spent) break;
    }

    await this.log.info(
      `  ${department.slug}: ${budget.claimed} new, ${await catalog.count(
        department.slug,
      )} in total`,
    );
  }

  /** Reads one product into the catalog; false when it added nothing. */
  private async capture(
    asin: string,
    department: Department,
    tab: Tab,
    catalog: Catalog,
  ): Promise<boolean> {
    // A refresh updates what is known and adds a capture to its history.
    if (!this.settings.refresh && await catalog.has(asin)) return false;

    const product = await tab.read(asin, department);
    if (!product) return false;

    await catalog.save(product);
    await this.log.info(`    ${asin}  ${product.title ?? "(untitled)"}`);
    return true;
  }
}

/**
 * The tabs a walk reads with. Listing pages are taken in order, so one tab
 * reads those; the products a listing ranks are independent, so every tab
 * reads them at once.
 */
class Tabs {
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
    read: (asin: string, tab: Tab) => Promise<void>,
  ): Promise<void> {
    return this.pool.run(asins, read);
  }

  async close(): Promise<void> {
    await Promise.all(this.tabs.map((tab) => tab.close()));
  }
}

/** One tab of the browser, reading whatever page it is pointed at. */
class Tab {
  private readonly results: SearchResultsPage;
  private readonly product: ProductPage;

  constructor(
    private readonly page: Page,
    private readonly urls: AmazonUrls,
    private readonly settings: DiscoverySettings,
    private readonly log: RunLog,
  ) {
    this.results = new SearchResultsPage(page);
    this.product = new ProductPage(page);
  }

  /** The ASINs one listing page ranks, in the order Amazon ranked them. */
  async asins(department: Department, page: number): Promise<string[]> {
    await this.page.goto(this.urls.department(department.node, page), {
      waitUntil: "domcontentloaded",
    });
    if (!await this.results.waitForResults()) return [];
    return await this.results.asins();
  }

  /** Reads one product; a page that will not load costs that product only. */
  async read(
    asin: string,
    department: Department,
  ): Promise<Product | undefined> {
    try {
      await this.page.goto(this.urls.product(asin), {
        waitUntil: "domcontentloaded",
      });
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
}

function wholeNumber(flag: string, value: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} takes a whole number of at least ${minimum}.`);
  }
  return parsed;
}
