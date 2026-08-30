import { assertEquals, assertThrows } from "@std/assert";
import { command } from "./command.ts";
import { Config } from "./config.ts";
import { Credentials } from "./credentials.ts";

const shopper = () =>
  new Credentials({
    get: (key: string) =>
      ({
        AMAZON_EMAIL: "shopper@example.com",
        AMAZON_PASSWORD: "hunter2",
      })[key],
  });

Deno.test("a walk goes signed out, in a profile the account never reaches", async () => {
  const config = await Config.load(`${await Deno.makeTempDir()}/none.toml`);

  const walk = command(["discover", "--departments=books"], config, shopper());
  assertEquals(walk.signedIn, false);
  assertEquals(walk.profile, config.walkDataDir);

  const signIn = command([], config, shopper());
  assertEquals(signIn.signedIn, true);
  assertEquals(signIn.profile, config.userDataDir);
});

Deno.test("a command that is not one is refused, by name", async () => {
  const config = await Config.load(`${await Deno.makeTempDir()}/none.toml`);

  assertThrows(
    () => command(["browse"], config, shopper()),
    Error,
    "Unknown command: browse",
  );
});
