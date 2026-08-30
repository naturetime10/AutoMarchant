/**
 * A fixed set of workers draining one queue of jobs. Every worker takes the
 * next job the moment it is free, so a slow job holds up its own worker only,
 * and a worker is never handed two jobs at once — which is what lets a worker
 * be something exclusive, such as a browser tab.
 */
export class WorkerPool<W> {
  constructor(private readonly workers: readonly W[]) {
    if (workers.length === 0) {
      throw new Error("A worker pool needs at least one worker.");
    }
  }

  /** Runs the jobs, and rethrows the first failure once the rest have. */
  async run<T>(
    jobs: Iterable<T>,
    job: (item: T, worker: W) => Promise<void>,
  ): Promise<void> {
    const queue = jobs[Symbol.iterator]();
    let failure: { error: unknown } | undefined;

    await Promise.all(this.workers.map(async (worker) => {
      // A failure stops the queue; jobs already running still finish.
      while (!failure) {
        const next = queue.next();
        if (next.done) return;
        try {
          await job(next.value, worker);
        } catch (error) {
          failure ??= { error };
        }
      }
    }));

    if (failure) throw failure.error;
  }
}

/**
 * One section at a time, in the order the sections arrived. What a pool runs
 * in parallel still has to take turns over anything it shares — a database
 * connection, a file being appended to.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(section: () => Promise<T>): Promise<T> {
    const result = this.tail.then(section, section);
    // The next section waits for this one either way, but not on its failure.
    this.tail = result.catch(() => {});
    return result;
  }
}

/**
 * How many of something may still be taken, shared by whoever is taking them.
 * A place is claimed before the work that fills it starts, so a cap holds
 * however many jobs are running at once, and given back when that work turns
 * out to fill nothing.
 */
export class Budget {
  private taken = 0;

  constructor(private readonly limit: number) {}

  /** What the budget has been spent on so far. */
  get claimed(): number {
    return this.taken;
  }

  get spent(): boolean {
    return this.taken >= this.limit;
  }

  /** Takes a place, unless the limit is already reached. */
  claim(): boolean {
    if (this.spent) return false;
    this.taken++;
    return true;
  }

  release(): void {
    this.taken--;
  }
}
