import type { BrowserContext } from "playwright";
import { Catalog } from "./catalog.ts";
import { productRow, TABLES } from "./catalog_db.ts";
import type { Diagnostics } from "./diagnostics.ts";
import {
  type Department,
  DEPARTMENTS,
  selectDepartments,
} from "./departments.ts";
import { Flags } from "../flags.ts";
import { ImageStore } from "./image_store.ts";
import type { Reader, Readers } from "./tabs.ts";
import { Tabs } from "./tabs.ts";
import type { RunLog } from "../run_log.ts";
import type { AmazonUrls } from "./urls.ts";

export interface AuditOptions {
  departments?: readonly Department[];
  /** Records to check per department; every one of them by default. */
  maxProducts?: number;
  outputDir?: string;
  databaseUrl?: string;
  /** Breathing room between product pages, so the audit stays polite. */
  pauseMs?: number;
  /** Product pages read at once, a tab each; five of them by default. */
  concurrency?: number;
}

/** What one `audit` run should cover, and where to write what it made of it. */
export class AuditSettings {
  readonly departments: readonly Department[];
  readonly maxProducts: number;
  readonly outputDir: string;
  readonly databaseUrl: string;
  readonly pauseMs: number;
  readonly concurrency: number;

  constructor(options: AuditOptions = {}) {
    this.departments = options.departments ?? DEPARTMENTS;
    this.maxProducts = options.maxProducts ?? Number.POSITIVE_INFINITY;
    this.outputDir = options.outputDir ?? "../output/market/discover";
    this.databaseUrl = options.databaseUrl ??
      "postgresql://localhost:5432/automerchant";
    this.pauseMs = options.pauseMs ?? 1200;
    this.concurrency = options.concurrency ?? 5;
  }

  /** Reads the flags `main.ts audit` was given, over what .env set. */
  static parse(
    args: string[],
    defaults: { outputDir: string; databaseUrl: string; concurrency: number },
  ): AuditSettings {
    const flags = new Flags(args, "audit", [
      "departments",
      "products",
      "out",
      "database",
      "pause",
      "concurrency",
    ]);
    const departments = flags.words("departments");

    return new AuditSettings({
      departments: departments && selectDepartments(departments),
      maxProducts: flags.count("products", 1),
      outputDir: flags.text("out") ?? defaults.outputDir,
      databaseUrl: flags.text("database") ?? defaults.databaseUrl,
      pauseMs: flags.count("pause", 0),
      concurrency: flags.count("concurrency", 1) ?? defaults.concurrency,
    });
  }
}

/** What an audit made of one record. */
export type Verdict =
  /** The page still reads the way the record does. */
  | "matches"
  /** The page says something else now, field by field. */
  | "differs"
  /** There is no product page behind the record any more. */
  | "gone";

/** One column where a record and the page behind it disagree. */
export interface Difference {
  field: string;
  /** What the catalog holds, as it reads. */
  stored: string | null;
  /** What the page says now; absent where it no longer says anything. */
  found: string | null;
}

/** What an audit made of one record, and when it looked. */
export interface Finding {
  asin: string;
  /** ISO timestamp of the moment the page behind the record was read. */
  checkedAt: string;
  verdict: Verdict;
  differences: Difference[];
}

/**
 * The columns an audit does not hold against a record. The ASIN is the
 * record's name rather than something to check; the URL is whatever Amazon
 * redirected the ASIN to on the day it was read, and a slug that has changed
 * says nothing about the product; the department is where the walk found the
 * product rather than something the page claims; and the capture is the
 * moment of the reading, which differs by definition.
 */
const UNJUDGED = new Set(["asin", "url", "department", "captured_at"]);

/**
 * Where the record the catalog holds and the page behind it disagree. Both
 * are the same row — what the catalog wrote then, and what it would write now
 * — so the columns are compared as they read, and a price the catalog keeps
 * as a number is the same fact as the one the page priced it at.
 */
export function differences(
  stored: readonly unknown[],
  found: readonly unknown[],
): Difference[] {
  const apart: Difference[] = [];
  TABLES.products.forEach((field, column) => {
    if (UNJUDGED.has(field)) return;
    if (text(stored[column]) === text(found[column])) return;
    apart.push({
      field,
      stored: text(stored[column]),
      found: text(found[column]),
    });
  });
  return apart;
}

/** A column as it reads, whatever Postgres or a page made of it. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * One `audit` run: the catalog it checks and the tabs it reads the pages
 * behind it with, opened once and handed to an inspection of every department
 * the run covers.
 */
export class Audit {
  constructor(
    private readonly context: BrowserContext,
    private readonly urls: AmazonUrls,
    private readonly settings: AuditSettings,
    private readonly log: RunLog,
    private readonly diagnostics: Diagnostics,
  ) {}

  async run(): Promise<void> {
    const catalog = await Catalog.open(
      this.settings.outputDir,
      this.settings.databaseUrl,
      // An audit saves no product, so no image is ever asked of the store.
      ImageStore.into(this.settings.outputDir, 0),
    );
    const tabs = await Tabs.open(
      this.context,
      this.settings,
      this.urls,
      this.log,
      this.diagnostics,
    );
    try {
      const inspection = new Inspection(
        this.settings,
        tabs,
        catalog,
        this.log,
      );
      for (const department of this.settings.departments) {
        await inspection.of(department);
      }
    } finally {
      await catalog.close();
      await tabs.close();
    }
  }
}

/**
 * One department's records, each checked against the page behind it. The
 * records it has been longest since checking go first, so an audit capped by
 * --products carries on where the last one stopped and a catalog is worked
 * through over as many runs as it takes.
 *
 * An audit reads and reports; it changes no record it disagrees with. What a
 * page says now is what `discover --refresh` is for, and the audit is what
 * says which products are worth spending it on.
 */
export class Inspection {
  constructor(
    private readonly settings: AuditSettings,
    private readonly pages: Readers,
    private readonly catalog: Catalog,
    private readonly log: RunLog,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Checks one department's records, as far as the run's cap goes. */
  async of(department: Department): Promise<void> {
    const due = await this.catalog.toAudit(
      department.slug,
      this.settings.maxProducts,
    );
    if (due.length === 0) return;

    await this.log.info(`${department.name} -> ${this.catalog.label}`);
    const tally = { checked: 0, differs: 0, gone: 0 };

    await this.pages.each(due, async (asin, reader) => {
      const verdict = await this.check(asin, department, reader);
      if (!verdict) return;
      tally.checked++;
      if (verdict === "differs") tally.differs++;
      if (verdict === "gone") tally.gone++;
    });

    await this.log.info(
      `  ${department.slug}: ${tally.checked} checked, ` +
        `${tally.differs} differs, ${tally.gone} gone`,
    );
  }

  /** Checks one record; nothing comes of a record that is no longer there. */
  private async check(
    asin: string,
    department: Department,
    reader: Reader,
  ): Promise<Verdict | undefined> {
    const stored = await this.catalog.record(asin);
    // A record a walk let go of between the audit listing it and reading it
    // is no longer a record to have an opinion about.
    if (!stored) return undefined;

    const checkedAt = this.now().toISOString();
    const found = await reader.read(asin, department);
    const apart = found ? differences(stored, productRow(found)) : [];

    if (!found) {
      // A page that would not load says the record has nothing behind it any
      // more — a product Amazon has taken down, as often as not.
      await this.log.error(`    ${asin}  gone: no product page`);
    } else if (apart.length > 0) {
      await this.log.info(
        `    ${asin}  differs: ${apart.map(({ field }) => field).join(", ")}`,
      );
    }

    const verdict: Verdict = !found
      ? "gone"
      : apart.length > 0
      ? "differs"
      : "matches";
    await this.catalog.audited({
      asin,
      checkedAt,
      verdict,
      differences: apart,
    });
    return verdict;
  }
}
