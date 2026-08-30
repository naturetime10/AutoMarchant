import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Config } from "./config.ts";

/** Writes a config.toml to read back. */
async function file(toml: string): Promise<string> {
  const path = `${await Deno.makeTempDir()}/config.toml`;
  await Deno.writeTextFile(path, toml);
  return path;
}

Deno.test("the built-in settings stand when there is no config.toml", async () => {
  const config = await Config.load(`${await Deno.makeTempDir()}/none.toml`);

  assertEquals(config.headless, false);
  assertEquals(config.userDataDir, ".playwright/amazon");
  assertEquals(config.artifactsDir, "artifacts");
  assertEquals(config.outputDir, "../output/market/discover");
  assertEquals(config.concurrency, 1);
});

Deno.test("config.toml settles how the browser runs and what a walk does", async () => {
  const config = await Config.load(
    await file(`
    [browser]
    headless = true
    user_data_dir = "/tmp/profile"
    artifacts_dir = "/tmp/artifacts"

    [discover]
    concurrency = 6
    output_dir = "/tmp/catalog"
  `),
  );

  assertEquals(config.headless, true);
  assertEquals(config.userDataDir, "/tmp/profile");
  assertEquals(config.artifactsDir, "/tmp/artifacts");
  assertEquals(config.outputDir, "/tmp/catalog");
  assertEquals(config.concurrency, 6);
});

Deno.test("a section left out keeps the settings it holds", async () => {
  const config = await Config.load(
    await file("[discover]\nconcurrency = 3\n"),
  );

  assertEquals(config.concurrency, 3);
  assertEquals(config.headless, false);
  assertEquals(config.outputDir, "../output/market/discover");
});

Deno.test("a concurrency that is not a count is refused, by name", async () => {
  const none = await file("[discover]\nconcurrency = 0\n");
  const word = await file('[discover]\nconcurrency = "lots"\n');

  await assertRejects(() => Config.load(none), Error, "discover.concurrency");
  await assertRejects(() => Config.load(word), Error, "discover.concurrency");
});

Deno.test("a setting of the wrong kind is refused, by name", async () => {
  const headless = await file('[browser]\nheadless = "yes"\n');
  const profile = await file("[browser]\nuser_data_dir = 3\n");
  const section = await file("browser = true\n");

  await assertRejects(() => Config.load(headless), Error, "browser.headless");
  await assertRejects(
    () => Config.load(profile),
    Error,
    "browser.user_data_dir",
  );
  await assertRejects(() => Config.load(section), Error, "browser");
});

Deno.test("the settings can be built without a file at all", () => {
  assertEquals(new Config().concurrency, 1);
  assertThrows(
    () => new Config({ discover: { concurrency: -1 } }),
    Error,
    "discover.concurrency",
  );
});
