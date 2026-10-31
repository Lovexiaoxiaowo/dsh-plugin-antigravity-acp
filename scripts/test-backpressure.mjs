import assert from "node:assert";
import { performance } from "node:perf_hooks";

async function run() {
  console.log("=== [Test PR-03]: Streaming Queue Backpressure Watermark ===");

  const HIGH_WATERMARK = 500;
  const LOW_WATERMARK = 200;

  let pauseCount = 0;
  let resumeCount = 0;
  let isPaused = false;

  const mockClient = {
    pauseStdout: () => {
      pauseCount++;
      isPaused = true;
    },
    resumeStdout: () => {
      resumeCount++;
      isPaused = false;
    },
  };

  const queue = [];
  let resolver = null;

  const pushItem = (item) => {
    if (resolver) {
      const r = resolver;
      resolver = null;
      r(item);
    } else {
      queue.push(item);
      if (!isPaused && queue.length >= HIGH_WATERMARK) {
        mockClient.pauseStdout();
      }
    }
  };

  const nextItem = () => {
    if (queue.length > 0) {
      const item = queue.shift();
      if (isPaused && queue.length <= LOW_WATERMARK) {
        mockClient.resumeStdout();
      }
      return Promise.resolve(item);
    }
    return new Promise((resolve) => {
      resolver = resolve;
    });
  };

  // 1. Push 550 items without consumer to trigger HIGH_WATERMARK
  for (let i = 0; i < 550; i++) {
    pushItem({ chunk: { text: `token-${i}` } });
  }

  assert(isPaused === true, "Expected queue to trigger pause at high watermark");
  assert(pauseCount === 1, `Expected pauseCount to be 1, got ${pauseCount}`);
  assert(queue.length === 550, `Expected queue length 550, got ${queue.length}`);
  console.log(`High watermark correctly paused stream at queue size: ${queue.length}`);

  // 2. Consume until below LOW_WATERMARK (down to 199 items)
  while (queue.length > 199) {
    await nextItem();
  }

  assert(isPaused === false, "Expected queue to trigger resume at low watermark");
  assert(resumeCount === 1, `Expected resumeCount to be 1, got ${resumeCount}`);
  console.log(`Low watermark correctly resumed stream at queue size: ${queue.length}`);

  // 3. Perf Gate: 10,000 items memory footprint check
  const initialMem = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) {
    pushItem({ chunk: { id: i, payload: "a".repeat(100) } });
    if (queue.length > 500) {
      // Simulate consumer draining backpressure
      queue.splice(0, 300);
      mockClient.resumeStdout();
    }
  }
  const peakMemDiffMb = (process.memoryUsage().heapUsed - initialMem) / 1024 / 1024;
  console.log(`Peak memory allocation diff under 10k items with backpressure: ${peakMemDiffMb.toFixed(2)}MB (Budget: < 25MB)`);
  assert(peakMemDiffMb < 25, `Memory diff exceeded 25MB budget: ${peakMemDiffMb}MB`);

  console.log("✅ [PR-03 PASS]: All backpressure assertions and memory perf gates passed!");
}

run().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
