import type { Page } from "playwright";
import type { AmazonCredentials } from "../config.ts";
import { totp } from "../totp.ts";

// Order history is a real auth gate. /gp/css/homepage.html is not: it renders
// a "Your Account" page for signed-out visitors instead of redirecting.
const ORDERS_URL = "https://www.amazon.com/gp/css/order-history";

const SELECTOR = {
  email: "input[name='email']",
  emailContinue: "input#continue, #continue input[type='submit']",
  password: "input[name='password']",
  rememberMe: "input[name='rememberMe']",
  signInSubmit: "input#signInSubmit",
  otp: "input#auth-mfa-otpcode",
  otpSubmit: "input#auth-signin-button",
  otpRemember: "input#auth-mfa-remember-device",
  captchaImage: "#auth-captcha-image",
  registerIntent: "form#intent-confirmation-form",
  errorBox: "#auth-error-message-box",
} as const;

/** Every page the sign-in flow can land on that we know how to classify. */
export type SignInState =
  | "signed-in"
  | "email"
  | "password"
  | "otp"
  | "captcha"
  | "no-account"
  | "unknown";

export interface LoginOptions {
  /** Set false in headless runs: a human cannot solve a captcha there. */
  interactive?: boolean;
  /** Milliseconds to wait for a human to clear a captcha. */
  captchaTimeoutMs?: number;
}

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return await page.locator(selector).first().isVisible().catch(() => false);
}

/** The red banner Amazon shows for a bad password, expired code, and so on. */
async function authError(page: Page): Promise<string | undefined> {
  const text = await page.locator(SELECTOR.errorBox).first().textContent()
    .catch(() => null);
  return text?.replace(/\s+/g, " ").trim() || undefined;
}

export async function detectState(page: Page): Promise<SignInState> {
  if (await isVisible(page, SELECTOR.captchaImage)) return "captcha";
  if (await isVisible(page, SELECTOR.otp)) return "otp";
  if (await isVisible(page, SELECTOR.password)) return "password";
  if (await isVisible(page, SELECTOR.email)) return "email";
  // Same /ax/claim URL as the password step, but offering signup instead.
  if (await isVisible(page, SELECTOR.registerIntent)) return "no-account";

  // /ap/ and /ax/ are Amazon's authentication paths (the password step lives
  // under /ax/claim); anywhere else means the flow let us through to the site.
  return /\/(ap|ax)\//.test(page.url()) ? "unknown" : "signed-in";
}

/**
 * Amazon renders each step asynchronously, so a state read straight after a
 * click sees an empty page. Poll until a page we recognize has rendered.
 */
export async function waitForState(
  page: Page,
  timeoutMs = 15_000,
): Promise<SignInState> {
  const deadline = Date.now() + timeoutMs;
  let state = await detectState(page);

  while (state === "unknown" && Date.now() < deadline) {
    await page.waitForTimeout(250);
    state = await detectState(page);
  }
  return state;
}

/**
 * Opens order history. Amazon bounces signed-out visitors to /ap/signin, so
 * this is both the check and the entry point into the sign-in form.
 */
export async function isSignedIn(page: Page): Promise<boolean> {
  await page.goto(ORDERS_URL, { waitUntil: "domcontentloaded" });
  return await waitForState(page) === "signed-in";
}

async function readOtp(credentials: AmazonCredentials): Promise<string> {
  if (credentials.totpSecret) return await totp(credentials.totpSecret);

  const code = prompt("Amazon 2FA code:")?.trim();
  if (!code) throw new Error("A 2FA code is required to finish signing in.");
  return code;
}

/**
 * Signs in if needed, leaving the page on order history. A persistent profile
 * that is still authenticated skips the form entirely.
 */
export async function login(
  page: Page,
  credentials: AmazonCredentials,
  { interactive = true, captchaTimeoutMs = 180_000 }: LoginOptions = {},
): Promise<void> {
  if (await isSignedIn(page)) return;

  // Each pass handles one page of the flow; the count caps a redirect loop.
  let previous: SignInState | undefined;
  for (let step = 0; step < 12; step++) {
    const state = await waitForState(page);

    // Amazon re-serves the same form when it rejects an entry, so a repeat
    // means our value was wrong rather than that the flow advanced.
    if (state === previous && (state === "email" || state === "password")) {
      throw new Error(
        await authError(page) ?? `Amazon rejected the ${state} we submitted.`,
      );
    }
    previous = state;

    switch (state) {
      case "signed-in":
        return;

      case "email":
        await page.fill(SELECTOR.email, credentials.email);
        await page.click(SELECTOR.emailContinue);
        break;

      case "password": {
        // Some variants of the form ask for both fields on one page.
        if (await isVisible(page, SELECTOR.email)) {
          await page.fill(SELECTOR.email, credentials.email);
        }
        await page.fill(SELECTOR.password, credentials.password);
        if (await isVisible(page, SELECTOR.rememberMe)) {
          await page.check(SELECTOR.rememberMe);
        }
        await page.click(SELECTOR.signInSubmit);
        break;
      }

      case "otp": {
        await page.fill(SELECTOR.otp, await readOtp(credentials));
        if (await isVisible(page, SELECTOR.otpRemember)) {
          await page.check(SELECTOR.otpRemember);
        }
        await page.click(SELECTOR.otpSubmit);
        break;
      }

      case "no-account":
        throw new Error(
          `Amazon offered to create a new account for ${credentials.email}, ` +
            "so no account exists for it. Check AMAZON_EMAIL.",
        );

      case "captcha": {
        if (!interactive) {
          throw new Error(
            "Amazon served a captcha. Re-run with HEADLESS=false and solve it " +
              "once; the saved profile carries the session forward.",
          );
        }
        console.log("Solve the captcha in the browser window; waiting...");
        await page.waitForSelector(SELECTOR.captchaImage, {
          state: "detached",
          timeout: captchaTimeoutMs,
        });
        break;
      }

      case "unknown":
        throw new Error(
          `Unrecognized sign-in page: ${page.url()}` +
            (await authError(page) ? ` — ${await authError(page)}` : ""),
        );
    }

    await page.waitForLoadState("domcontentloaded");
  }

  throw new Error("Gave up after 12 sign-in steps without reaching the account.");
}
