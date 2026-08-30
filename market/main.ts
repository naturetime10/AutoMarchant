import { AmazonSession } from "./src/amazon/session.ts";
import { Config } from "./src/config.ts";

async function signIn(config: Config): Promise<void> {
  const session = await AmazonSession.open(config);
  try {
    await session.signIn();
    console.log(`Signed in to Amazon as ${config.email}`);
  } catch (error) {
    await session.saveDiagnostics();
    throw error;
  } finally {
    await session.close();
  }
}

if (import.meta.main) {
  try {
    await signIn(new Config());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
