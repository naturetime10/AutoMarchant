import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Budget, Mutex, WorkerPool } from "./concurrency.ts";

/** Resolves once the event loop has been given a chance to run elsewhere. */
function pause(ms = 1): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("a pool hands every job to one of its workers", async () => {
  const pool = new WorkerPool(["a", "b", "c"]);
  const done: string[] = [];

  await pool.run([1, 2, 3, 4, 5, 6, 7], async (job, worker) => {
    await pause();
    done.push(`${worker}${job}`);
  });

  assertEquals(done.length, 7);
  assertEquals(done.map((entry) => Number(entry.slice(1))).sort(), [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
  ]);
});

Deno.test("a pool runs as many jobs at once as it has workers", async () => {
  const pool = new WorkerPool(["a", "b"]);
  let running = 0;
  let mostAtOnce = 0;
  const busy = new Set<string>();

  await pool.run([1, 2, 3, 4, 5, 6], async (_job, worker) => {
    // A worker is one tab: two jobs must never share it.
    assertEquals(busy.has(worker), false);
    busy.add(worker);
    mostAtOnce = Math.max(mostAtOnce, ++running);
    await pause();
    running--;
    busy.delete(worker);
  });

  assertEquals(mostAtOnce, 2);
});

Deno.test("a pool stops at the first failure and reports it", async () => {
  const pool = new WorkerPool(["a"]);
  const started: number[] = [];

  await assertRejects(
    () =>
      pool.run([1, 2, 3, 4], async (job) => {
        started.push(job);
        await pause();
        if (job === 2) throw new Error("job 2 failed");
      }),
    Error,
    "job 2 failed",
  );

  assertEquals(started, [1, 2]);
});

Deno.test("a pool without a worker is a mistake, not a silent no-op", () => {
  assertThrows(() => new WorkerPool([]), Error, "worker");
});

Deno.test("a mutex runs its sections one at a time, in order", async () => {
  const mutex = new Mutex();
  const order: string[] = [];

  const section = async (name: string, ms: number) => {
    await mutex.run(async () => {
      order.push(`${name} in`);
      await pause(ms);
      order.push(`${name} out`);
    });
  };

  await Promise.all([section("first", 5), section("second", 1)]);

  assertEquals(order, ["first in", "first out", "second in", "second out"]);
});

Deno.test("a mutex passes on what a section returned", async () => {
  assertEquals(await new Mutex().run(() => Promise.resolve(7)), 7);
});

Deno.test("a section that throws leaves the mutex usable", async () => {
  const mutex = new Mutex();

  await assertRejects(
    () => mutex.run(() => Promise.reject(new Error("nope"))),
    Error,
    "nope",
  );
  assertEquals(await mutex.run(() => Promise.resolve("after")), "after");
});

Deno.test("a budget hands out places up to its limit, and no more", () => {
  const budget = new Budget(2);

  assertEquals(budget.claim(), true);
  assertEquals(budget.claim(), true);
  assertEquals(budget.spent, true);
  assertEquals(budget.claim(), false);
  assertEquals(budget.claimed, 2);
});

Deno.test("a place given back is a place someone else can claim", () => {
  const budget = new Budget(1);

  assertEquals(budget.claim(), true);
  budget.release();

  assertEquals(budget.spent, false);
  assertEquals(budget.claimed, 0);
  assertEquals(budget.claim(), true);
});

Deno.test("a budget without a limit never runs out", () => {
  const budget = new Budget(Number.POSITIVE_INFINITY);

  for (let i = 0; i < 1000; i++) assertEquals(budget.claim(), true);
  assertEquals(budget.spent, false);
  assertEquals(budget.claimed, 1000);
});
