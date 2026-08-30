import type { Page } from "playwright";
import { Catalog } from "./catalog.ts";
import {
  type Department,
  DEPARTMENTS,
  selectDepartments,
} from "./departments.ts";
import { ImageStore } from "./image_store.ts";
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
  }

  /** Reads the flags `main.ts discover` was given. */
  static parse(
    args: string[],
    defaults: { outputDir: string; databaseUrl: string },
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
        default:
          throw new Error(
            `Unknown discover option: ${arg}. Try --departments, --pages, ` +
              "--products, --out, --database, --images, --refresh, or --pause.",
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

  async run(): Promise<void> {
    const catalog = await Catalog.open(
      this.settings.outputDir,
      this.settings.databaseUrl,
      ImageStore.into(this.settings.outputDir, this.settings.imageLimit),
    );
    try {
      for (const department of this.settings.departments) {
        await this.walk(department, catalog);
      }
    } finally {
      await catalog.close();
    }
  }

  private async walk(department: Department, catalog: Catalog): Promise<void> {
    await this.log.info(`${department.name} -> ${catalog.label}`);

    let captured = 0;
    let previous = "";

    pages:
    for (let page = 1; page <= this.settings.maxPages; page++) {
      const asins = await this.listPage(department, page);
      // Past the last page Amazon re-serves the previous one rather than 404.
      const signature = asins.join(",");
      if (asins.length === 0 || signature === previous) break;
      previous = signature;

      await this.log.info(`  page ${page}: ${asins.length} products`);
      for (const asin of asins) {
        if (captured >= this.settings.maxProducts) break pages;
        // A refresh updates what is known and adds a capture to its history.
        if (!this.settings.refresh && await catalog.has(asin)) continue;

        const product = await this.capture(asin, department);
        if (!product) continue;

        await catalog.save(product);
        captured++;
        await this.log.info(`    ${asin}  ${product.title ?? "(untitled)"}`);
      }
    }

    await this.log.info(
      `  ${department.slug}: ${captured} new, ${await catalog.count(
        department.slug,
      )} in total`,
    );
  }

  private async listPage(
    department: Department,
    page: number,
  ): Promise<string[]> {
    await this.page.goto(this.urls.department(department.node, page), {
      waitUntil: "domcontentloaded",
    });
    if (!await this.results.waitForResults()) return [];
    return await this.results.asins();
  }

  /** Reads one product; a page that will not load costs that product only. */
  private async capture(asin: string, department: Department) {
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
}

function wholeNumber(flag: string, value: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} takes a whole number of at least ${minimum}.`);
  }
  return parsed;
}
