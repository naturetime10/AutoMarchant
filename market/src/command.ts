import { AuditSettings } from "./amazon/audit.ts";
import type { AmazonSession } from "./amazon/session.ts";
import { DiscoverySettings } from "./amazon/discovery.ts";
import type { Config } from "./config.ts";
import type { Credentials } from "./credentials.ts";

/** What a run does, and the browser it needs to do it in. */
export interface Command {
  /** The Chromium profile it opens. */
  readonly profile: string;
  /** Whether the Amazon account has to be behind it. */
  readonly signedIn: boolean;
  run(session: AmazonSession): Promise<void>;
}

/** Reads the command line, so a typo fails before a browser is launched. */
export function command(
  args: string[],
  config: Config,
  credentials: Credentials,
): Command {
  const [name = "sign-in", ...rest] = args;

  switch (name) {
    case "sign-in":
      return {
        profile: config.userDataDir,
        signedIn: true,
        run: () => Promise.resolve(),
      };

    case "discover": {
      const settings = DiscoverySettings.parse(rest, {
        outputDir: config.outputDir,
        databaseUrl: credentials.databaseUrl,
        concurrency: config.concurrency,
      });
      // A walk reads what any visitor may read, and Amazon throttles the
      // account that reads too much of it: signed in, every listing came back
      // 503 in a tenth of a second while product pages kept serving, and the
      // refusal followed the account's cookies rather than the machine. So a
      // walk goes signed out, in a profile the account never reaches.
      return {
        profile: config.walkDataDir,
        signedIn: false,
        run: (session) => session.discover(settings),
      };
    }

    case "audit": {
      const settings = AuditSettings.parse(rest, {
        outputDir: config.outputDir,
        databaseUrl: credentials.databaseUrl,
        concurrency: config.concurrency,
      });
      // An audit reads the same pages a walk does, and is throttled the same
      // way for reading too many of them, so it reads in the walk's profile.
      return {
        profile: config.walkDataDir,
        signedIn: false,
        run: (session) => session.audit(settings),
      };
    }

    default:
      throw new Error(
        `Unknown command: ${name}. Try sign-in, discover, or audit.`,
      );
  }
}
