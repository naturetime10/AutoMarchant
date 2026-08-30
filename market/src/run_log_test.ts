import { assertEquals, assertStringIncludes } from "@std/assert";
import { RunLog } from "./run_log.ts";

const at = (iso: string) => () => new Date(iso);

Deno.test("RunLog timestamps every line it writes to the file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const log = await RunLog.open(
      dir,
      "discover.log",
      () => {},
      at("2026-08-29T00:00:00.000Z"),
    );
    await log.info("Electronics");
    await log.error("B000000001 skipped");

    const lines = (await Deno.readTextFile(`${dir}/discover.log`))
      .trimEnd().split("\n");
    assertEquals(lines.length, 2);
    assertEquals(lines[0], "2026-08-29T00:00:00.000Z Electronics");
    assertStringIncludes(lines[1], "ERROR B000000001 skipped");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("RunLog echoes the message alone, so the terminal stays readable", async () => {
  const dir = await Deno.makeTempDir();
  const echoed: string[] = [];
  try {
    const log = await RunLog.open(
      dir,
      "discover.log",
      (line) => echoed.push(line),
    );
    await log.info("  page 1: 39 products");

    assertEquals(echoed, ["  page 1: 39 products"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("RunLog keeps what earlier runs logged", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await (await RunLog.open(dir, "discover.log", () => {})).info("first run");
    await (await RunLog.open(dir, "discover.log", () => {})).info("second run");

    const contents = await Deno.readTextFile(`${dir}/discover.log`);
    assertStringIncludes(contents, "first run");
    assertStringIncludes(contents, "second run");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a log keeps a line per message when they arrive at once", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const log = await RunLog.open(dir, "discover.log", () => {});

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => log.info(`line ${index}`)),
    );

    const lines = (await Deno.readTextFile(`${dir}/discover.log`)).trimEnd()
      .split("\n");
    assertEquals(lines.length, 20);
    assertEquals(lines.every((line) => /^\S+ line \d+$/.test(line)), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
