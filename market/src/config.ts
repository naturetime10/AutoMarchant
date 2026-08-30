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
   * Where a discovery run writes its catalog and log. Recipes run inside
   * market/, so the default climbs to the repo-wide output tree.
   */
  readonly outputDir: string;

  constructor(env: Pick<Deno.Env, "get"> = Deno.env) {
    this.email = Config.require(env, "AMAZON_EMAIL");
    this.password = Config.require(env, "AMAZON_PASSWORD");
    this.totpSecret = env.get("AMAZON_TOTP_SECRET")?.trim() || undefined;
    this.headless = env.get("HEADLESS") === "true";
    this.userDataDir = env.get("USER_DATA_DIR")?.trim() || ".playwright/amazon";
    this.artifactsDir = env.get("ARTIFACTS_DIR")?.trim() || "artifacts";
    this.outputDir = env.get("OUTPUT_DIR")?.trim() ||
      "../output/market/discover";
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
