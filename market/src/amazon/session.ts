import { type BrowserContext, chromium, type Page } from "playwright";
import type { Config } from "../config.ts";
import { OtpSource } from "../otp.ts";
import { SignInPage, type SignInStep } from "./sign_in_page.ts";
import { Tour, type TourStop } from "./tour.ts";
import { AmazonUrls } from "./urls.ts";

/** Caps a redirect loop between sign-in pages. */
const MAX_STEPS = 12;

/** A Chromium profile signed in to Amazon; the profile outlives the process. */
export class AmazonSession {
  private readonly signInPage: SignInPage;
  private readonly otp: OtpSource;
  private readonly urls = new AmazonUrls();

  private constructor(
    private readonly config: Config,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {
    this.signInPage = new SignInPage(page);
    this.otp = OtpSource.from(config);
  }

  static async open(config: Config): Promise<AmazonSession> {
    await Deno.mkdir(config.userDataDir, { recursive: true });

    const context = await chromium.launchPersistentContext(config.userDataDir, {
      headless: config.headless,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const page = context.pages()[0] ?? await context.newPage();

    return new AmazonSession(config, context, page);
  }

  /**
   * Opens order history, a real auth gate: signed-out visitors are bounced to
   * /ap/signin. (/gp/css/homepage.html is not — it renders for them instead.)
   */
  async isSignedIn(): Promise<boolean> {
    await this.page.goto(this.urls.orderHistory(), {
      waitUntil: "domcontentloaded",
    });
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

  /** Walks the given pages, outlining the regions worth scraping on each. */
  async tour(stops: TourStop[], pauseMs = 2500): Promise<void> {
    await new Tour(this.page, `${this.config.artifactsDir}/tour`, pauseMs).run(
      stops,
    );
  }

  /** Records what the failing page looked like, for after-the-fact debugging. */
  async saveDiagnostics(): Promise<void> {
    try {
      await Deno.mkdir(this.config.artifactsDir, { recursive: true });
      const stem = `${this.config.artifactsDir}/${
        new Date().toISOString().replaceAll(":", "-")
      }`;
      await this.page.screenshot({ path: `${stem}.png`, fullPage: true });
      await Deno.writeTextFile(`${stem}.html`, await this.page.content());
      console.error(`Wrote ${stem}.{png,html}`);
    } catch (error) {
      console.error("Could not write diagnostics:", error);
    }
  }

  close(): Promise<void> {
    return this.context.close();
  }

  private async advance(step: SignInStep): Promise<void> {
    switch (step) {
      case "email":
        return await this.signInPage.submitEmail(this.config.email);

      case "password":
        return await this.signInPage.submitPassword(
          this.config.email,
          this.config.password,
        );

      case "otp":
        return await this.signInPage.submitOtp(await this.otp.code());

      case "captcha": {
        if (this.config.headless) {
          throw new Error(
            "Amazon served a captcha. Re-run with HEADLESS=false and solve it " +
              "once; the saved profile carries the session forward.",
          );
        }
        console.log("Solve the captcha in the browser window; waiting...");
        return await this.signInPage.awaitCaptchaCleared(180_000);
      }

      case "no-account":
        throw new Error(
          `Amazon offered to create a new account for ${this.config.email}, ` +
            "so no account exists for it. Check AMAZON_EMAIL.",
        );

      case "unknown":
        throw new Error(`Unrecognized sign-in page: ${this.signInPage.url}`);

      case "signed-in":
        return;
    }
  }
}
