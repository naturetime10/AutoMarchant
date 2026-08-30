export interface AmazonCredentials {
  email: string;
  password: string;
  /** Base32 secret from Amazon's authenticator-app 2FA setup. Optional. */
  totpSecret?: string;
}

export interface Config {
  credentials: AmazonCredentials;
  headless: boolean;
  /** Chromium profile directory; keeps the Amazon session between runs. */
  userDataDir: string;
  /** Where failure screenshots and HTML dumps are written. */
  artifactsDir: string;
}

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export function loadConfig(): Config {
  return {
    credentials: {
      email: required("AMAZON_EMAIL"),
      password: required("AMAZON_PASSWORD"),
      totpSecret: Deno.env.get("AMAZON_TOTP_SECRET")?.trim() || undefined,
    },
    // Amazon flags headless Chromium aggressively, so default to a real window.
    headless: Deno.env.get("HEADLESS") === "true",
    userDataDir: Deno.env.get("USER_DATA_DIR")?.trim() || ".playwright/amazon",
    artifactsDir: Deno.env.get("ARTIFACTS_DIR")?.trim() || "artifacts",
  };
}
