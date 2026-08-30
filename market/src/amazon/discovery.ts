import type { BrowserContext } from "playwright";
import { Budget } from "../concurrency.ts";
import { Catalog } from "./catalog.ts";
import type { Diagnostics } from "./diagnostics.ts";
import {
  type Department,
  DEPARTMENTS,
  selectDepartments,
} from "./departments.ts";
import { Flags } from "../flags.ts";
import { ImageStore } from "./image_store.ts";
import type { Pages, Reader } from "./tabs.ts";
import { Tabs } from "./tabs.ts";
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
    const flags = new Flags(args, "discover", [
      "departments",
      "pages",
      "products",
      "out",
      "database",
      "images",
      "refresh",
      "restart",
      "pause",
      "concurrency",
    ]);
    const departments = flags.words("departments");

    return new DiscoverySettings({
      departments: departments && selectDepartments(departments),
      maxPages: flags.count("pages", 1),
      maxProducts: flags.count("products", 1),
      outputDir: flags.text("out") ?? defaults.outputDir,
      databaseUrl: flags.text("database") ?? defaults.databaseUrl,
      imageLimit: flags.count("images", 0),
      refresh: flags.given("refresh"),
      restart: flags.given("restart"),
      pauseMs: flags.count("pause", 0),
      concurrency: flags.count("concurrency", 1) ?? defaults.concurrency,
    });
  }
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
    private readonly diagnostics: Diagnostics,
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
      this.diagnostics,
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
      if (queued.length > 0) {
        await this.log.info(`  ${queued.length} queued by an earlier walk`);
      }
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

    for (let page = first; page <= last && !budget.spent; page++) {
      const listing = await this.pages.list(department, page);
      if (listing.asins.length === 0) {
        // Not the end of the listings — the paginator is what says that — but
        // a page that ranked nothing because it never drew. The place is
        // kept, so the next walk asks for this page rather than taking the
        // department for one that has been read to the end.
        await this.log.error(`  page ${page}: nothing ranked; stopping here`);
        return;
      }

      await this.log.info(`  page ${page}: ${listing.asins.length} products`);
      // The page is queued before a product of it is read, so the walk has no
      // reason to open the page again: whatever it does not get to now is in
      // the queue, and read by the walk after it.
      await this.catalog.listed(department.slug, page, listing.asins);
      await this.catalog.keepPlace(department.slug, page + 1);
      const due = this.settings.refresh
        ? listing.asins
        : await this.catalog.unread(department.slug);
      await this.read(department, budget, tried, due);

      if (!listing.more) {
        // Amazon's paginator offers nothing after this page, and the page has
        // been read: the listings are listed out. The next walk starts at the
        // top, where what has newly been ranked appears.
        await this.catalog.forgetPlace(department.slug);
        return;
      }
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
