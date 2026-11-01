/**
 * Lightweight asynchronous semaphore to control concurrency across sessions
 * and prevent 429 Too Many Requests rate-limiting from backend providers.
 */
export declare class AsyncSemaphore {
    readonly maxConcurrency: number;
    private currentRunning;
    private readonly queue;
    constructor(maxConcurrency?: number);
    get running(): number;
    get waiting(): number;
    /**
     * Acquires a lease on the semaphore.
     * Returns a release function that must be called when the task finishes.
     */
    acquire(): Promise<() => void>;
    /**
     * Releases a lease and dispatches the next waiting task if available.
     */
    private release;
    /**
     * Helper to run an async operation protected by the semaphore.
     */
    runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=semaphore.d.ts.map