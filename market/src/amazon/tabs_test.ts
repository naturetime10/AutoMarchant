import { assertEquals, assertRejects } from "@std/assert";
import type { Page, Response } from "playwright";
import { Diagnostics } from "./diagnostics.ts";
import { selectDepartments } from "./departments.ts";
import { Blocked } from "./interstitial.ts";
import { RunLog } from "../run_log.ts";
import { Tab } from "./tabs.ts";
import { AmazonUrls } from "./urls.ts";

const [ELECTRONICS] = selectDepartments(["electronics"]);

/** A navigation that never came back, the way Playwright reports one. */
function timedOut(): Error {
  const error = new Error("page.goto: Timeout 30000ms exceeded.");
  error.name = "TimeoutError";
  return error;
}

/** A page that arrived, carrying the status Amazon answered with. */
function arrived(status = 200): Response {
  return { status: () => status } as Response;
}

/**
 * A browser tab that answers with whatever it was handed, in order: a
 * response for a page that arrived, an error for one that never did. It
 * records the urls it was asked for and the waits it was told to keep, which
 * is what says whether a tab asked again and how long it waited first.
 */
class FakePage {
  readonly asked: string[] = [];
  readonly waited: number[] = [];

  constructor(private readonly answers: (Response | Error)[]) {}

  goto(url: string): Promise<Response | null> {
    this.asked.push(url);
    const answer = this.answers.shift();
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer ?? null);
  }

  waitForTimeout(ms: number): Promise<void> {
    this.waited.push(ms);
    return Promise.resolve();
  }

  // A listing with nothing of Amazon's blocks on it: no gate, no 503 page.
  locator() {
    return { count: () => Promise.resolve(0) };
  }

  waitForSelector(): Promise<unknown> {
    return Promise.resolve({});
  }

  // `asins` is handed the tile selector; `offersPageAfter`, a list of them.
  evaluate(_fn: unknown, arg: unknown): Promise<unknown> {
    if (Array.isArray(arg)) return Promise.resolve(true);
    return Promise.resolve(["B00000001", "B00000002"]);
  }

  url(): string {
    return "about:blank";
  }

  content(): Promise<string> {
    return Promise.resolve("<html></html>");
  }

  screenshot(): Promise<void> {
    return Promise.resolve();
  }
}

// One log for the file's tests, written somewhere throwaway and echoed
// nowhere: what these tests check is what the tab did, not what it said.
const log = await RunLog.open(
  await Deno.makeTempDir(),
  "tabs_test.log",
  () => {},
);

function tabOver(page: FakePage): Tab {
  return new Tab(
    page as unknown as Page,
    new AmazonUrls(),
    { pauseMs: 0, concurrency: 1 },
    log,
    // Nowhere to write and nothing to say: a test that gives up on a page
    // should not leave a screenshot behind.
    new Diagnostics("", () => new Date(), () => {}),
  );
}

Deno.test("a tab waits out a page that never arrives, and asks again", async () => {
  // Amazon stops answering, then starts again — the walk that meets this
  // should come away with the listing rather than with an error.
  const page = new FakePage([timedOut(), timedOut(), arrived()]);

  const listing = await tabOver(page).listing(ELECTRONICS, 7);

  assertEquals(listing.asins, ["B00000001", "B00000002"]);
  assertEquals(page.asked.length, 3);
  // Each wait is twice the one before it, so a walk that Amazon keeps turning
  // away backs further off rather than asking at the same rate.
  assertEquals(page.waited, [5_000, 10_000]);
});

Deno.test("a tab gives up on a page that never arrives at all", async () => {
  // Amazon never starts answering. The walk stops, so that the department is
  // left where it stopped rather than recorded as having nothing in it.
  const page = new FakePage(
    Array.from({ length: 11 }, timedOut),
  );

  await assertRejects(
    () => tabOver(page).listing(ELECTRONICS, 7),
    Blocked,
  );
  assertEquals(page.asked.length, 11);
  // The wait doubles until it is long enough, then holds there: a block that
  // has already outlasted five minutes is waited out at that rate rather than
  // at one that runs away into hours.
  assertEquals(page.waited, [
    5_000,
    10_000,
    20_000,
    40_000,
    80_000,
    160_000,
    300_000,
    300_000,
    300_000,
    300_000,
  ]);
});

Deno.test("a product page that never arrives stops the walk", async () => {
  // A page that would not come says nothing about the product behind it, so
  // it is not written off the way a product page that loads and holds no
  // product is.
  const page = new FakePage(Array.from({ length: 11 }, timedOut));

  await assertRejects(
    () => tabOver(page).read("B00000001", ELECTRONICS),
    Blocked,
  );
});
