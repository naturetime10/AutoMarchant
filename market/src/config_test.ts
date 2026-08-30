import { assertEquals, assertThrows } from "@std/assert";
import { Config } from "./config.ts";

/** The environment a run reads, with the credentials already answered. */
function env(values: Record<string, string> = {}): Pick<Deno.Env, "get"> {
  const all: Record<string, string> = {
    AMAZON_EMAIL: "you@example.com",
    AMAZON_PASSWORD: "secret",
    ...values,
  };
  return { get: (name: string) => all[name] };
}

Deno.test("a walk reads with one tab unless the environment says otherwise", () => {
  assertEquals(new Config(env()).tabs, 1);
});

Deno.test("TABS sets how many tabs a walk reads with", () => {
  assertEquals(new Config(env({ TABS: "6" })).tabs, 6);
});

Deno.test("a TABS that is not a count fails before a browser is launched", () => {
  assertThrows(() => new Config(env({ TABS: "lots" })), Error, "TABS");
  assertThrows(() => new Config(env({ TABS: "0" })), Error, "TABS");
});

Deno.test("a missing credential names itself", () => {
  assertThrows(
    () => new Config({ get: () => undefined }),
    Error,
    "AMAZON_EMAIL",
  );
});
