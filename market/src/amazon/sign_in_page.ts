import type { Page } from "playwright";

const SELECTOR = {
  email: "input[name='email']",
  emailContinue: "input#continue, #continue input[type='submit']",
  password: "input[name='password']",
  rememberMe: "input[name='rememberMe']",
  submit: "input#signInSubmit",
  otp: "input#auth-mfa-otpcode",
  otpSubmit: "input#auth-signin-button",
  otpRemember: "input#auth-mfa-remember-device",
  captcha: "#auth-captcha-image",
  registerIntent: "form#intent-confirmation-form",
  error: "#auth-error-message-box",
} as const;

/** Every page of the sign-in flow this driver can recognize. */
export type SignInStep =
  | "signed-in"
  | "email"
  | "password"
  | "otp"
  | "captcha"
  | "no-account"
  | "unknown";

/**
 * Reads and drives Amazon's sign-in pages. Amazon varies the order of the
 * steps, so the current page is identified from its content rather than
 * assumed, and every action leaves the page loaded and ready to re-read.
 */
export class SignInPage {
  constructor(private readonly page: Page) {}

  get url(): string {
    return this.page.url();
  }

  /** Whichever page of the flow is on screen right now. */
  async step(): Promise<SignInStep> {
    if (await this.visible(SELECTOR.captcha)) return "captcha";
    if (await this.visible(SELECTOR.otp)) return "otp";
    if (await this.visible(SELECTOR.password)) return "password";
    if (await this.visible(SELECTOR.email)) return "email";
    // Shares the /ax/claim URL with the password step, but offers signup.
    if (await this.visible(SELECTOR.registerIntent)) return "no-account";

    // /ap/ and /ax/ are Amazon's authentication paths (the password step lives
    // under /ax/claim); anywhere else means the flow let us through.
    return /\/(ap|ax)\//.test(this.url) ? "unknown" : "signed-in";
  }

  /** Amazon renders each step asynchronously; poll until one is recognized. */
  async settledStep(timeoutMs = 15_000): Promise<SignInStep> {
    const deadline = Date.now() + timeoutMs;
    let step = await this.step();

    while (step === "unknown" && Date.now() < deadline) {
      await this.page.waitForTimeout(250);
      step = await this.step();
    }
    return step;
  }

  /** The red banner shown for a bad password, an expired code, and so on. */
  async error(): Promise<string | undefined> {
    const text = await this.page.locator(SELECTOR.error).first().textContent()
      .catch(() => null);
    return text?.replace(/\s+/g, " ").trim() || undefined;
  }

  async submitEmail(email: string): Promise<void> {
    await this.page.fill(SELECTOR.email, email);
    await this.submitWith(SELECTOR.emailContinue);
  }

  async submitPassword(email: string, password: string): Promise<void> {
    // Some variants of the form ask for both fields on one page.
    if (await this.visible(SELECTOR.email)) {
      await this.page.fill(SELECTOR.email, email);
    }
    await this.page.fill(SELECTOR.password, password);
    await this.checkIfVisible(SELECTOR.rememberMe);
    await this.submitWith(SELECTOR.submit);
  }

  async submitOtp(code: string): Promise<void> {
    await this.page.fill(SELECTOR.otp, code);
    await this.checkIfVisible(SELECTOR.otpRemember);
    await this.submitWith(SELECTOR.otpSubmit);
  }

  /** Blocks until a human clears the captcha in a visible window. */
  async awaitCaptchaCleared(timeoutMs: number): Promise<void> {
    await this.page.waitForSelector(SELECTOR.captcha, {
      state: "detached",
      timeout: timeoutMs,
    });
  }

  private async submitWith(selector: string): Promise<void> {
    await this.page.click(selector);
    await this.page.waitForLoadState("domcontentloaded");
  }

  private async checkIfVisible(selector: string): Promise<void> {
    if (await this.visible(selector)) await this.page.check(selector);
  }

  private visible(selector: string): Promise<boolean> {
    return this.page.locator(selector).first().isVisible().catch(() => false);
  }
}
