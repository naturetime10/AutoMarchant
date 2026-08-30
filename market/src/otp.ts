import type { Credentials } from "./credentials.ts";

/** Supplies the one-time code Amazon asks for when 2FA is enabled. */
export abstract class OtpSource {
  abstract code(): Promise<string>;

  static from(credentials: Credentials): OtpSource {
    return credentials.totpSecret
      ? new TotpSource(credentials.totpSecret)
      : new PromptOtpSource();
  }
}

/** Derives the code locally from an authenticator secret (RFC 6238). */
export class TotpSource extends OtpSource {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
    private readonly step = 30,
    private readonly digits = 6,
  ) {
    super();
  }

  async code(): Promise<string> {
    const counter = new ArrayBuffer(8);
    new DataView(counter).setBigUint64(
      0,
      BigInt(Math.floor(this.now() / 1000 / this.step)),
    );

    const key = await crypto.subtle.importKey(
      "raw",
      base32Decode(this.secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));

    // RFC 6238 dynamic truncation: the last nibble picks the 4-byte window.
    const offset = mac[mac.length - 1] & 0x0f;
    const binary = ((mac[offset] & 0x7f) << 24) |
      (mac[offset + 1] << 16) |
      (mac[offset + 2] << 8) |
      mac[offset + 3];

    return String(binary % 10 ** this.digits).padStart(this.digits, "0");
  }
}

/** Asks for the code on the terminal. */
export class PromptOtpSource extends OtpSource {
  code(): Promise<string> {
    const value = prompt("Amazon 2FA code:")?.trim();
    if (!value) throw new Error("A 2FA code is required to finish signing in.");
    return Promise.resolve(value);
  }
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;

  for (const char of input.replace(/[\s=]/g, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character in TOTP secret: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  const decoded = new Uint8Array(new ArrayBuffer(bytes.length));
  decoded.set(bytes);
  return decoded;
}
