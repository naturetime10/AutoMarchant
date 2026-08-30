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

/**
 * Empties every table; the foreign keys carry it to what a product owns. The
 * tables are the ones the database actually has, rather than a list kept here
 * in step with the schema — a database still waiting for its first test to
 * create the schema has none, and nothing to empty.
 */
export async function truncate(): Promise<void> {
  const client = new Client(connection(TEST_DATABASE_URL));
  await client.connect();
  try {
    const { rows } = await client.queryArray<[string]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    if (rows.length === 0) return;

    const tables = rows.map(([name]) => `"${name}"`).join(", ");
    await client.queryArray(`TRUNCATE ${tables} CASCADE`);
  } finally {
    await client.end();
  }
}

/** Reads the database directly, to check what the catalog actually wrote. */
export async function query<T>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  const client = new Client(connection(TEST_DATABASE_URL));
  await client.connect();
  try {
    const result = await client.queryObject<Record<string, unknown>>({
      text: sql,
      args,
    });
    return result.rows as T[];
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
