import { assertEquals, assertThrows } from "@std/assert";
import { Credentials } from "./credentials.ts";

const env = (values: Record<string, string>) => ({
  get: (key: string): string | undefined => values[key],
});

const SIGN_IN = {
  AMAZON_EMAIL: "shopper@example.com",
  AMAZON_PASSWORD: "hunter2",
};

Deno.test("credentials come from the environment, with a local database", () => {
  const credentials = new Credentials(env(SIGN_IN));

  assertEquals(credentials.email, "shopper@example.com");
  assertEquals(credentials.password, "hunter2");
  assertEquals(credentials.totpSecret, undefined);
  assertEquals(
    credentials.databaseUrl,
    "postgresql://localhost:5432/automerchant",
  );
});

Deno.test("a credential that is missing names itself", () => {
  assertThrows(() => new Credentials(env({})), Error, "AMAZON_EMAIL");
  assertThrows(
    () => new Credentials(env({ AMAZON_EMAIL: "shopper@example.com" })),
    Error,
    "AMAZON_PASSWORD",
  );
});
