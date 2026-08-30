/** Settings for a sign-in run, read from the environment (see .env.example). */
export class Config {
  readonly email: string;
  readonly password: string;
  readonly totpSecret?: string;
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
  /** The Postgres database the catalog is kept in. */
  readonly databaseUrl: string;
  /** How many product pages a walk reads at once, a browser tab each. */
  readonly tabs: number;

  constructor(env: Pick<Deno.Env, "get"> = Deno.env) {
    this.email = Config.require(env, "AMAZON_EMAIL");
    this.password = Config.require(env, "AMAZON_PASSWORD");
    this.totpSecret = env.get("AMAZON_TOTP_SECRET")?.trim() || undefined;
    this.headless = env.get("HEADLESS") === "true";
    this.userDataDir = env.get("USER_DATA_DIR")?.trim() || ".playwright/amazon";
    this.artifactsDir = env.get("ARTIFACTS_DIR")?.trim() || "artifacts";
    this.databaseUrl = env.get("DATABASE_URL")?.trim() ||
      "postgresql://localhost:5432/automerchant";
    this.outputDir = env.get("OUTPUT_DIR")?.trim() ||
      "../output/market/discover";
    this.tabs = Config.count(env, "TABS", 1);
  }

  private static count(
    env: Pick<Deno.Env, "get">,
    name: string,
    fallback: number,
  ): number {
    const value = env.get(name)?.trim();
    if (!value) return fallback;

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${name} takes a whole number of at least 1.`);
    }
    return parsed;
  }

  private static require(env: Pick<Deno.Env, "get">, name: string): string {
    const value = env.get(name)?.trim();
    if (!value) {
      throw new Error(
        `Missing ${name}. Copy .env.example to .env and fill it in.`,
      );
    }
    return value;
  }
}
