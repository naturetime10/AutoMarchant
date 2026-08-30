import { AmazonSession } from "./src/amazon/session.ts";
import { type Command, command } from "./src/command.ts";
import { Config } from "./src/config.ts";
import { Credentials } from "./src/credentials.ts";

async function run(
  config: Config,
  credentials: Credentials,
  command: Command,
): Promise<void> {
  const session = await AmazonSession.open(
    config,
    credentials,
    command.profile,
  );
  try {
    if (command.signedIn) {
      await session.signIn();
      console.log(`Signed in to Amazon as ${credentials.email}`);
    }
    await command.run(session);
  } catch (error) {
    await session.saveDiagnostics();
    throw error;
  } finally {
    await session.close();
  }
}

if (import.meta.main) {
  try {
    const config = await Config.load();
    const credentials = new Credentials();
    await run(config, credentials, command(Deno.args, config, credentials));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
