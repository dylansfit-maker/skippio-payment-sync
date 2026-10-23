/**
 * Concurrency abstraction: serialises async work per key.
 *
 * Services wrap each state-changing operation in `runExclusive(key, ...)` so
 * that check-then-act sequences (e.g. "is there an order? no -> create it and
 * call the POS") are atomic with respect to other callers using the same key.
 *
 * To scale beyond one process, provide another implementation of this
 * interface (Redis lock, Postgres advisory lock, ...). Callers don't change.
 */
export interface KeyedLock {
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>;
}

/** Single-process implementation: a promise chain per key. FIFO, no timeouts. */
export class InMemoryKeyedLock implements KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // `previous` can never reject: every tail is built from a gate that only resolves.
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      // Drop the entry when nobody queued behind us, so the map doesn't grow forever.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
