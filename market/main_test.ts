import { assertEquals, assertRejects } from "@std/assert";
import { Credentials } from "./src/credentials.ts";
import { OtpSource, PromptOtpSource, TotpSource } from "./src/otp.ts";

const env = (values: Record<string, string>) => ({
  get: (key: string): string | undefined => values[key],
});

const credentials = {
  AMAZON_EMAIL: "shopper@example.com",
  AMAZON_PASSWORD: "hunter2",
};

// RFC 6238 appendix B: ASCII secret "12345678901234567890" in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const at = (millis: number) => new TotpSource(RFC_SECRET, () => millis);

Deno.test("OtpSource uses the secret when there is one, else the prompt", () => {
  const withSecret = new Credentials(
    env({ ...credentials, AMAZON_TOTP_SECRET: RFC_SECRET }),
  );

  assertEquals(OtpSource.from(withSecret) instanceof TotpSource, true);
  assertEquals(
    OtpSource.from(new Credentials(env(credentials))) instanceof
      PromptOtpSource,
    true,
  );
});

Deno.test("TotpSource matches the RFC 6238 test vectors", async () => {
  assertEquals(await at(59_000).code(), "287082");
  assertEquals(await at(1_111_111_109_000).code(), "081804");
  assertEquals(await at(1_234_567_890_000).code(), "005924");
});

Deno.test("TotpSource tolerates spaces and padding in the secret", async () => {
  const spaced = new TotpSource(
    "gezd gnbv gy3t qojq gezd gnbv gy3t qojq=",
    () => 59_000,
  );
  assertEquals(await spaced.code(), "287082");
});

Deno.test("TotpSource rejects a malformed secret", async () => {
  await assertRejects(
    () => new TotpSource("not-base32!").code(),
    Error,
    "Invalid base32",
  );
});
