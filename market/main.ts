import { AmazonSession } from "./src/amazon/session.ts";
import { tourStops } from "./src/amazon/tour.ts";
import { AmazonUrls } from "./src/amazon/urls.ts";
import { Config } from "./src/config.ts";

async function signIn(config: Config, command?: string): Promise<void> {
  const session = await AmazonSession.open(config);
  try {
    await session.signIn();
    console.log(`Signed in to Amazon as ${config.email}`);
    if (command === "tour") await session.tour(tourStops(new AmazonUrls()));
  } catch (error) {
    await session.saveDiagnostics();
    throw error;
  } finally {
    await session.close();
  }
}

if (import.meta.main) {
  try {
    await signIn(new Config(), Deno.args[0]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
