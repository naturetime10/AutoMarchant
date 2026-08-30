/**
 * The secrets a run needs, read from the environment (see .env.example). The
 * settings that are not secret live in config.toml instead.
 */
export class Credentials {
  readonly email: string;
  readonly password: string;
  readonly totpSecret?: string;
  /** The Postgres the catalog is kept in; the string carries its password. */
  readonly databaseUrl: string;

  constructor(env: Pick<Deno.Env, "get"> = Deno.env) {
    this.email = Credentials.require(env, "AMAZON_EMAIL");
    this.password = Credentials.require(env, "AMAZON_PASSWORD");
    this.totpSecret = env.get("AMAZON_TOTP_SECRET")?.trim() || undefined;
    this.databaseUrl = env.get("DATABASE_URL")?.trim() ||
      "postgresql://localhost:5432/automerchant";
  }

  private static require(env: Pick<Deno.Env, "get">, name: string): string {
    const value = env.get(name)?.trim();
    if (!value) {
      throw new Error(
        `Missing ${name}. Copy .env.example to .env and fill it in.`,
      );
    }
    return value;
  }
}
