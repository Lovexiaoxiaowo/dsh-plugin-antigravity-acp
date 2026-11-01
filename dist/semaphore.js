/**
 * Lightweight asynchronous semaphore to control concurrency across sessions
 * and prevent 429 Too Many Requests rate-limiting from backend providers.
 */
export class AsyncSemaphore {
    maxConcurrency;
    currentRunning = 0;
    queue = [];
    constructor(maxConcurrency = 2) {
        this.maxConcurrency = maxConcurrency;
        if (maxConcurrency < 1) {
            throw new Error("maxConcurrency must be at least 1");
        }
    }
    get running() {
        return this.currentRunning;
    }
    get waiting() {
        return this.queue.length;
    }
    /**
     * Acquires a lease on the semaphore.
     * Returns a release function that must be called when the task finishes.
     */
    async acquire() {
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
        return new Promise((resolve) => {
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
    release() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                next();
            }
        }
        else {
            this.currentRunning = Math.max(0, this.currentRunning - 1);
        }
    }
    /**
     * Helper to run an async operation protected by the semaphore.
     */
    async runExclusive(fn) {
        const release = await this.acquire();
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
}
//# sourceMappingURL=semaphore.js.map