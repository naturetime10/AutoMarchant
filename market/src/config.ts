import { parse } from "@std/toml";

/** Where the settings are kept, relative to market/. */
const PATH = "config.toml";

/** A table of settings, as TOML parses one. */
type Settings = Record<string, unknown>;

/**
 * What a run does and how it does it, read from config.toml. Nothing here is
 * a secret — the sign-in and the database string come from the environment
 * instead, as `Credentials`.
 */
export class Config {
  /** Amazon flags headless Chromium, so a real window is the default. */
  readonly headless: boolean;
  /** Chromium profile directory; keeps the Amazon session between runs. */
  readonly userDataDir: string;
  /** Where screenshots and HTML dumps of a failed run are written. */
  readonly artifactsDir: string;
  /**
   * Where a discovery run writes its images, CSV, and log. Recipes run inside
   * market/, so the default climbs to the repo-wide output tree.
   */
  readonly outputDir: string;
  /** How many product pages a walk reads at once, a browser tab each. */
  readonly concurrency: number;

  constructor(settings: Settings = {}) {
    const browser = new Section("browser", settings);
    const discover = new Section("discover", settings);

    this.headless = browser.flag("headless", false);
    this.userDataDir = browser.text("user_data_dir", ".playwright/amazon");
    this.artifactsDir = browser.text("artifacts_dir", "artifacts");
    this.outputDir = discover.text("output_dir", "../output/market/discover");
    this.concurrency = discover.count("concurrency", 16);
  }

  /** Reads config.toml; the built-in settings stand when it is not there. */
  static async load(path = PATH): Promise<Config> {
    const toml = await Deno.readTextFile(path).catch((error: unknown) => {
      if (error instanceof Deno.errors.NotFound) return "";
      throw error;
    });
    return new Config(parse(toml));
  }
}

/**
 * One `[section]` of config.toml. A setting it does not name keeps the value
 * the code was written with; one it names wrongly is refused by name, before
 * a browser is launched.
 */
class Section {
  private readonly settings: Settings;

  constructor(private readonly name: string, table: Settings) {
    const section = table[name] ?? {};
    if (
      typeof section !== "object" || section === null || Array.isArray(section)
    ) {
      throw new Error(`${name} is a section of config.toml, not a value.`);
    }
    this.settings = section as Settings;
  }

  flag(key: string, fallback: boolean): boolean {
    const value = this.settings[key];
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
      throw new Error(
        `${this.where(key)} is true or false, not ${show(value)}.`,
      );
    }
    return value;
  }

  text(key: string, fallback: string): string {
    const value = this.settings[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${this.where(key)} takes a path, not ${show(value)}.`);
    }
    return value.trim();
  }

  count(key: string, fallback: number): number {
    const value = this.settings[key];
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new Error(
        `${this.where(key)} takes a whole number of at least 1, not ${
          show(value)
        }.`,
      );
    }
    return value;
  }

  private where(key: string): string {
    return `${this.name}.${key}`;
  }
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}
