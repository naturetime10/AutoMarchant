import { AmazonSession } from "./src/amazon/session.ts";
import { DiscoverySettings } from "./src/amazon/discovery.ts";
import { Config } from "./src/config.ts";
import { Credentials } from "./src/credentials.ts";

/** What a run does once the session is signed in. */
type Task = (session: AmazonSession) => Promise<void>;

/** Reads the command line, so a typo fails before a browser is launched. */
function task(
  args: string[],
  config: Config,
  credentials: Credentials,
): Task {
  const [command = "sign-in", ...rest] = args;

  switch (command) {
    case "sign-in":
      return () => Promise.resolve();

    case "discover": {
      const settings = DiscoverySettings.parse(rest, {
        outputDir: config.outputDir,
        databaseUrl: credentials.databaseUrl,
        concurrency: config.concurrency,
      });
      return (session) => session.discover(settings);
    }

    default:
      throw new Error(`Unknown command: ${command}. Try sign-in or discover.`);
  }
}

async function run(
  config: Config,
  credentials: Credentials,
  task: Task,
): Promise<void> {
  const session = await AmazonSession.open(config, credentials);
  try {
    await session.signIn();
    console.log(`Signed in to Amazon as ${credentials.email}`);
    await task(session);
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
    await run(config, credentials, task(Deno.args, config, credentials));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
