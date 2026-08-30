import { Client } from "@db/postgres";
import { connection } from "./catalog_db.ts";

/**
 * The database the tests run against. They write real tables, so they need a
 * Postgres to write them to; without one they are skipped rather than failed,
 * and `deno test` says so.
 */
export const TEST_DATABASE_URL = Deno.env.get("TEST_DATABASE_URL") ??
  "postgresql://localhost:5432/automerchant_test";

export const offline = !await reachable();

if (offline) {
  console.warn(
    `No Postgres at ${TEST_DATABASE_URL} — database tests are being skipped. ` +
      "Set TEST_DATABASE_URL, or see the README for the one-time setup.",
  );
}

/** Declares a test that needs the database. */
export function test(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, ignore: offline, fn });
}

/** Empties every table; the foreign keys carry it to what a product owns. */
export async function truncate(): Promise<void> {
  const client = new Client(connection(TEST_DATABASE_URL));
  await client.connect();
  try {
    await client.queryArray(
      "TRUNCATE products, categories, attributes, features, images, reviews, " +
        "questions, styling_ideas, captures CASCADE",
    );
  } catch {
    // Nothing to empty until the first test creates the schema.
  } finally {
    await client.end();
  }
}

async function reachable(): Promise<boolean> {
  const client = new Client(connection(TEST_DATABASE_URL));
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}
