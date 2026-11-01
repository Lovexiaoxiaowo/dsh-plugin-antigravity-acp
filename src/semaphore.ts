/**
 * Lightweight asynchronous semaphore to control concurrency across sessions
 * and prevent 429 Too Many Requests rate-limiting from backend providers.
 */
export class AsyncSemaphore {
  private currentRunning = 0;
  private readonly queue: Array<() => void> = [];

  constructor(public readonly maxConcurrency: number = 2) {
    if (maxConcurrency < 1) {
      throw new Error("maxConcurrency must be at least 1");
    }
  }

  get running(): number {
    return this.currentRunning;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Acquires a lease on the semaphore.
   * Returns a release function that must be called when the task finishes.
   */
  async acquire(): Promise<() => void> {
    if (this.currentRunning < this.maxConcurrency) {
      this.currentRunning++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      });
    });
  }

  /**
   * Releases a lease and dispatches the next waiting task if available.
   */
  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    } else {
      this.currentRunning = Math.max(0, this.currentRunning - 1);
    }
  }

  /**
   * Helper to run an async operation protected by the semaphore.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
