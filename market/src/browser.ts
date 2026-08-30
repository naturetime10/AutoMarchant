import { type BrowserContext, chromium } from "playwright";
import type { Config } from "./config.ts";

/**
 * Opens a persistent Chromium profile. Cookies survive between runs, so a
 * successful sign-in usually means later runs skip the login form entirely.
 */
export async function openContext(config: Config): Promise<BrowserContext> {
  await Deno.mkdir(config.userDataDir, { recursive: true });

  return await chromium.launchPersistentContext(config.userDataDir, {
    headless: config.headless,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    args: ["--disable-blink-features=AutomationControlled"],
  });
}
