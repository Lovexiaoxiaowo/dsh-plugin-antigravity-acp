import { describe, it, expect } from "vitest";
import { AsyncSemaphore } from "../src/semaphore";

describe("AsyncSemaphore unit test", () => {
  it("enforces maxConcurrency limit", async () => {
    const sem = new AsyncSemaphore(2);
    expect(sem.maxConcurrency).toBe(2);
    expect(sem.running).toBe(0);
    expect(sem.waiting).toBe(0);

    const rel1 = await sem.acquire();
    expect(sem.running).toBe(1);

    const rel2 = await sem.acquire();
    expect(sem.running).toBe(2);

    let thirdAcquired = false;
    const p3 = sem.acquire().then((rel3) => {
      thirdAcquired = true;
      return rel3;
    });

    expect(sem.waiting).toBe(1);
    expect(thirdAcquired).toBe(false);

    rel1();
    const rel3 = await p3;
    expect(thirdAcquired).toBe(true);
    expect(sem.running).toBe(2);
    expect(sem.waiting).toBe(0);

    rel2();
    rel3();
    expect(sem.running).toBe(0);
  });

  it("handles runExclusive cleanly", async () => {
    const sem = new AsyncSemaphore(1);
    const order: number[] = [];

    const t1 = sem.runExclusive(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
      return "res1";
    });

    const t2 = sem.runExclusive(async () => {
      order.push(2);
      return "res2";
    });

    const [r1, r2] = await Promise.all([t1, t2]);
    expect(r1).toBe("res1");
    expect(r2).toBe("res2");
    expect(order).toEqual([1, 2]);
  });
});
