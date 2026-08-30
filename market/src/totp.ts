const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;

  for (const char of clean) {
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

/** RFC 6238 time-based one-time password. */
export async function totp(
  secret: string,
  at: number = Date.now(),
  { step = 30, digits = 6 } = {},
): Promise<string> {
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(
    0,
    BigInt(Math.floor(at / 1000 / step)),
  );

  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));

  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];

  return String(binary % 10 ** digits).padStart(digits, "0");
}
