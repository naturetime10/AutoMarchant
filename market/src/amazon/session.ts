import { type BrowserContext, chromium, type Page } from "playwright";
import type { Config } from "../config.ts";
import type { Credentials } from "../credentials.ts";
import { OtpSource } from "../otp.ts";
import { RunLog } from "../run_log.ts";
import { Diagnostics } from "./diagnostics.ts";
import { Discovery, type DiscoverySettings } from "./discovery.ts";
import { SignInPage, type SignInStep } from "./sign_in_page.ts";
import { AmazonUrls } from "./urls.ts";

// Order history is a real auth gate. /gp/css/homepage.html is not: it renders
// a "Your Account" page for signed-out visitors instead of redirecting.
const ORDERS_URL = "https://www.amazon.com/gp/css/order-history";

/** Caps a redirect loop between sign-in pages. */
const MAX_STEPS = 12;

/** A Chromium profile signed in to Amazon; the profile outlives the process. */
export class AmazonSession {
  private readonly signInPage: SignInPage;
  private readonly otp: OtpSource;
  /** One run, one artifact: whichever page was given up on first. */
  private readonly diagnostics: Diagnostics;

  private constructor(
    private readonly config: Config,
    private readonly credentials: Credentials,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {
    this.signInPage = new SignInPage(page);
    this.otp = OtpSource.from(credentials);
    this.diagnostics = new Diagnostics(config.artifactsDir);
  }

  static async open(
    config: Config,
    credentials: Credentials,
  ): Promise<AmazonSession> {
    await Deno.mkdir(config.userDataDir, { recursive: true });

    const context = await chromium.launchPersistentContext(config.userDataDir, {
      headless: config.headless,
      // Amazon's layout follows the viewport, so the window fills the screen
      // and the viewport follows it. Headless has no screen to fill.
      viewport: config.headless ? { width: 1920, height: 1080 } : null,
      locale: "en-US",
      args: [
        "--disable-blink-features=AutomationControlled",
        ...(config.headless ? [] : ["--start-maximized"]),
      ],
    });
    const page = context.pages()[0] ?? await context.newPage();

    return new AmazonSession(config, credentials, context, page);
  }

  /** Opens order history; signed-out visitors are bounced to /ap/signin. */
  async isSignedIn(): Promise<boolean> {
    await this.page.goto(ORDERS_URL, { waitUntil: "domcontentloaded" });
    return await this.signInPage.settledStep() === "signed-in";
  }

  /**
   * Signs in unless the stored profile is still authenticated, leaving the
   * page on order history.
   */
  async signIn(): Promise<void> {
    if (await this.isSignedIn()) return;

    let previous: SignInStep | undefined;
    for (let attempt = 0; attempt < MAX_STEPS; attempt++) {
      const step = await this.signInPage.settledStep();
      if (step === "signed-in") return;

      // Amazon re-serves the same form when it rejects an entry, so a repeat
      // means our value was wrong rather than that the flow advanced.
      if (step === previous && (step === "email" || step === "password")) {
        throw new Error(
          await this.signInPage.error() ??
            `Amazon rejected the ${step} we submitted.`,
        );
      }
      previous = step;
      await this.advance(step);
    }

    throw new Error(`Gave up after ${MAX_STEPS} sign-in steps.`);
  }

  /** Walks each department's listings, recording every product found. */
  async discover(settings: DiscoverySettings): Promise<void> {
    const log = await RunLog.open(settings.outputDir);
    await new Discovery(
      this.context,
      new AmazonUrls(),
      settings,
      log,
      this.diagnostics,
    ).run();
  }

  /**
   * Records what the failing page looked like, for after-the-fact debugging.
   * A walk that gave up on a page of its own has already written that one —
   * the tab it was reading with is closed by now, and this page, the one
   * sign-in was left on, is not what went wrong.
   */
  saveDiagnostics(): Promise<void> {
    return this.diagnostics.save(this.page);
  }

  close(): Promise<void> {
    return this.context.close();
  }

  private async advance(step: SignInStep): Promise<void> {
    switch (step) {
      case "email":
        return await this.signInPage.submitEmail(this.credentials.email);

      case "password":
        return await this.signInPage.submitPassword(
          this.credentials.email,
          this.credentials.password,
        );

      case "otp":
        return await this.signInPage.submitOtp(await this.otp.code());

      case "captcha": {
        if (this.config.headless) {
          throw new Error(
            "Amazon served a captcha. Set headless = false in config.toml, " +
              "re-run, and solve it once; the saved profile carries the " +
              "session forward.",
          );
        }
        console.log("Solve the captcha in the browser window; waiting...");
        return await this.signInPage.awaitCaptchaCleared(180_000);
      }

      case "no-account":
        throw new Error(
          "Amazon offered to create a new account for " +
            `${this.credentials.email}, so no account exists for it. ` +
            "Check AMAZON_EMAIL.",
        );

      case "unknown":
        throw new Error(`Unrecognized sign-in page: ${this.signInPage.url}`);

      case "signed-in":
        return;
    }
  }
}
