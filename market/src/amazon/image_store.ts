/** An image Amazon showed, and where it was saved if it could be fetched. */
export interface StoredImage {
  url: string;
  /** Relative to the output directory; absent when the download failed. */
  path?: string;
}

/** Fetches one image's bytes. */
export type FetchImage = (url: string) => Promise<Uint8Array>;

/** How long to wait on one image before giving up on it. */
const TIMEOUT_MS = 20_000;

/**
 * The preview images, filed under the product they belong to. An image
 * already on disk is left alone, so a rerun costs nothing for what it has.
 */
export class ImageStore {
  constructor(
    private readonly dir: string,
    private readonly fetchImage: FetchImage = download,
    /** How many images to keep per product. */
    private readonly limit = Number.POSITIVE_INFINITY,
  ) {}

  /** The store a real run uses, fetching over the network. */
  static into(dir: string, limit: number): ImageStore {
    return new ImageStore(dir, download, limit);
  }

  async save(asin: string, urls: string[]): Promise<StoredImage[]> {
    const wanted = urls.slice(0, Math.max(this.limit, 0));
    if (wanted.length === 0) return urls.map((url) => ({ url }));

    await Deno.mkdir(`${this.dir}/images/${asin}`, { recursive: true });

    const saved: StoredImage[] = [];
    for (const [index, url] of wanted.entries()) {
      saved.push(await this.store(asin, url, index + 1));
    }
    return [...saved, ...urls.slice(wanted.length).map((url) => ({ url }))];
  }

  private async store(
    asin: string,
    url: string,
    position: number,
  ): Promise<StoredImage> {
    const path = `images/${asin}/${String(position).padStart(2, "0")}${
      extension(url)
    }`;
    const full = `${this.dir}/${path}`;

    if (await exists(full)) return { url, path };

    try {
      await Deno.writeFile(full, await this.fetchImage(url));
      return { url, path };
    } catch {
      // One image missing is not worth losing the product over.
      return { url };
    }
  }
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function extension(url: string): string {
  return URL.parse(url)?.pathname.match(/\.[a-z0-9]{2,4}$/i)?.[0] ?? ".jpg";
}

function exists(path: string): Promise<boolean> {
  return Deno.stat(path).then((file) => file.size > 0).catch(() => false);
}
