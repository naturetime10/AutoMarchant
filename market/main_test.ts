import { assertEquals, assertRejects } from "@std/assert";
import { totp } from "./src/totp.ts";
import { loadConfig } from "./src/config.ts";

// RFC 6238 appendix B: ASCII secret "12345678901234567890" in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

Deno.test("totp matches the RFC 6238 test vectors", async () => {
  assertEquals(await totp(RFC_SECRET, 59_000), "287082");
  assertEquals(await totp(RFC_SECRET, 1_111_111_109_000), "081804");
  assertEquals(await totp(RFC_SECRET, 1_234_567_890_000), "005924");
});

Deno.test("totp tolerates spaces and padding in the secret", async () => {
  assertEquals(await totp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq=", 59_000), "287082");
});

Deno.test("totp rejects a malformed secret", async () => {
  await assertRejects(() => totp("not-base32!", 0), Error, "Invalid base32");
});

Deno.test("loadConfig reads credentials and defaults", () => {
  Deno.env.set("AMAZON_EMAIL", "shopper@example.com");
  Deno.env.set("AMAZON_PASSWORD", "hunter2");
  Deno.env.delete("AMAZON_TOTP_SECRET");
  Deno.env.delete("HEADLESS");

  const config = loadConfig();
  assertEquals(config.credentials.email, "shopper@example.com");
  assertEquals(config.credentials.totpSecret, undefined);
  assertEquals(config.headless, false);
  assertEquals(config.userDataDir, ".playwright/amazon");
});

Deno.test("loadConfig fails loudly without credentials", () => {
  Deno.env.delete("AMAZON_EMAIL");
  Deno.env.delete("AMAZON_PASSWORD");

  try {
    loadConfig();
    throw new Error("expected loadConfig to throw");
  } catch (error) {
    assertEquals((error as Error).message.includes("AMAZON_EMAIL"), true);
  }
});
