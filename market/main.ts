import { isSignedIn, login } from "./src/amazon/login.ts";
import { openContext } from "./src/browser.ts";
import { type Config, loadConfig } from "./src/config.ts";
import type { Page } from "playwright";

/** Saves a screenshot and the raw HTML so a failed run can be diagnosed. */
async function dumpArtifacts(page: Page, dir: string): Promise<void> {
  try {
    await Deno.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    await page.screenshot({ path: `${dir}/${stamp}.png`, fullPage: true });
    await Deno.writeTextFile(`${dir}/${stamp}.html`, await page.content());
    console.error(`Wrote failure artifacts to ${dir}/${stamp}.{png,html}`);
  } catch (error) {
    console.error("Could not write failure artifacts:", error);
  }
}

export async function signIn(config: Config): Promise<void> {
  const context = await openContext(config);
  const page = context.pages()[0] ?? await context.newPage();

  try {
    await login(page, config.credentials, { interactive: !config.headless });
    if (!await isSignedIn(page)) {
      throw new Error("Sign-in finished but order history is still gated.");
    }
    console.log(`Signed in to Amazon as ${config.credentials.email}`);
  } catch (error) {
    await dumpArtifacts(page, config.artifactsDir);
    throw error;
  } finally {
    await context.close();
  }
}

if (import.meta.main) {
  try {
    await signIn(loadConfig());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
