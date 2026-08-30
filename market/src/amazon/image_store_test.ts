import { assertEquals } from "@std/assert";
import { ImageStore } from "./image_store.ts";

const bytes = new Uint8Array([1, 2, 3]);

const fetcher = () => {
  const asked: string[] = [];
  return {
    asked,
    fetch: (url: string): Promise<Uint8Array> => {
      asked.push(url);
      if (url.includes("broken")) return Promise.reject(new Error("404"));
      return Promise.resolve(bytes);
    },
  };
};

const inTempDir = async (test: (dir: string) => Promise<void>) => {
  const dir = await Deno.makeTempDir();
  try {
    await test(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
};

Deno.test("ImageStore files each image under the product it belongs to", async () => {
  await inTempDir(async (dir) => {
    const saved = await new ImageStore(dir, fetcher().fetch).save(
      "B000000001",
      [
        "https://m.media-amazon.com/images/I/1.jpg",
        "https://m.media-amazon.com/images/I/2.png",
      ],
    );

    assertEquals(saved.map((image) => image.path), [
      "images/B000000001/01.jpg",
      "images/B000000001/02.png",
    ]);
    assertEquals(
      (await Deno.readFile(`${dir}/images/B000000001/01.jpg`)).length,
      3,
    );
  });
});

Deno.test("ImageStore leaves an image it already has on disk alone", async () => {
  await inTempDir(async (dir) => {
    const first = fetcher();
    await new ImageStore(dir, first.fetch).save("B000000001", [
      "https://m.media-amazon.com/images/I/1.jpg",
    ]);

    const second = fetcher();
    const saved = await new ImageStore(dir, second.fetch).save("B000000001", [
      "https://m.media-amazon.com/images/I/1.jpg",
    ]);

    assertEquals(second.asked, []);
    assertEquals(saved[0].path, "images/B000000001/01.jpg");
  });
});

Deno.test("ImageStore keeps the url of an image it could not fetch", async () => {
  await inTempDir(async (dir) => {
    const saved = await new ImageStore(dir, fetcher().fetch).save(
      "B000000001",
      [
        "https://m.media-amazon.com/images/I/broken.jpg",
        "https://m.media-amazon.com/images/I/2.jpg",
      ],
    );

    assertEquals(saved[0], {
      url: "https://m.media-amazon.com/images/I/broken.jpg",
    });
    assertEquals(saved[1].path, "images/B000000001/02.jpg");
  });
});

Deno.test("ImageStore downloads up to its limit, but records them all", async () => {
  await inTempDir(async (dir) => {
    const asking = fetcher();
    const saved = await new ImageStore(dir, asking.fetch, 1).save(
      "B000000001",
      [
        "https://m.media-amazon.com/images/I/1.jpg",
        "https://m.media-amazon.com/images/I/2.jpg",
      ],
    );

    assertEquals(asking.asked.length, 1);
    assertEquals(saved[0].path, "images/B000000001/01.jpg");
    assertEquals(saved[1], {
      url: "https://m.media-amazon.com/images/I/2.jpg",
    });
  });
});

Deno.test("ImageStore downloads nothing when it is turned off", async () => {
  await inTempDir(async (dir) => {
    const asking = fetcher();
    const saved = await new ImageStore(dir, asking.fetch, 0).save(
      "B000000001",
      [
        "https://m.media-amazon.com/images/I/1.jpg",
      ],
    );

    assertEquals(asking.asked, []);
    assertEquals(saved, [{ url: "https://m.media-amazon.com/images/I/1.jpg" }]);
  });
});
