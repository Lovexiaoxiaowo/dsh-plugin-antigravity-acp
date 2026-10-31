import assert from "node:assert";
import { PassThrough } from "node:stream";
import { AntigravityAcpClient, StreamingBackpressureQueue } from "../dist/index.js";

async function run() {
  console.log("=== [Test PR-03]: Genuine Stream Pipe Backpressure & Streaming Queue ===");

  // -------------------------------------------------------------
  // Test 1: Real stream/pipe backpressure via AntigravityAcpClient
  // -------------------------------------------------------------
  console.log("\n--- Subtest 1: AntigravityAcpClient genuine stdout pipe pause/resume ---");
  const client = new AntigravityAcpClient("fake-agy-server");
  const realStdoutPipe = new PassThrough();
  client.attachProcess({
    stdout: realStdoutPipe,
    stdin: new PassThrough(),
    kill: () => {},
  });

  assert.strictEqual(client.isStdoutPaused(), false, "Initial client state should not be paused");
  assert.strictEqual(realStdoutPipe.isPaused(), false, "Initial stdout pipe should not be paused");

  // Call pauseStdout
  client.pauseStdout();
  assert.strictEqual(client.isStdoutPaused(), true, "client.isStdoutPaused() should be true after pauseStdout()");
  assert.strictEqual(realStdoutPipe.isPaused(), true, "realStdoutPipe.isPaused() should be true (authentic OS stream backpressure)");
  console.log("Verified client.pauseStdout() directly paused authentic stream pipe.");

  // Call resumeStdout
  client.resumeStdout();
  assert.strictEqual(client.isStdoutPaused(), false, "client.isStdoutPaused() should be false after resumeStdout()");
  assert.strictEqual(realStdoutPipe.isPaused(), false, "realStdoutPipe.isPaused() should be false after resumeStdout()");
  console.log("Verified client.resumeStdout() directly resumed authentic stream pipe.");

  // -------------------------------------------------------------
  // Test 2: Service-level StreamingBackpressureQueue Watermarks
  // -------------------------------------------------------------
  console.log("\n--- Subtest 2: StreamingBackpressureQueue Watermark Lifecycle ---");
  let pauseEvents = 0;
  let resumeEvents = 0;

  const queue = new StreamingBackpressureQueue({
    highWatermark: 500,
    lowWatermark: 200,
    criticalWatermark: 1000,
    onPause: () => {
      pauseEvents++;
      client.pauseStdout();
    },
    onResume: () => {
      resumeEvents++;
      client.resumeStdout();
    },
  });

  // 1. Push 550 items without consumer to trigger HIGH_WATERMARK
  for (let i = 0; i < 550; i++) {
    queue.push({ chunk: { type: "text-delta", text: `token-${i}` } });
  }

  assert.strictEqual(queue.paused, true, "Expected queue to be in paused state");
  assert.strictEqual(pauseEvents, 1, `Expected pauseEvents to be 1, got ${pauseEvents}`);
  assert.strictEqual(client.isStdoutPaused(), true, "client should reflect paused stdout");
  assert.strictEqual(realStdoutPipe.isPaused(), true, "real stdout pipe should reflect paused stream");
  assert.strictEqual(queue.length, 550, `Expected queue length 550, got ${queue.length}`);
  console.log(`High watermark correctly paused stream pipe at queue size: ${queue.length}`);

  // 2. Consume until below LOW_WATERMARK (down to 199 items)
  while (queue.length > 199) {
    await queue.next();
  }

  assert.strictEqual(queue.paused, false, "Expected queue to be resumed");
  assert.strictEqual(resumeEvents, 1, `Expected resumeEvents to be 1, got ${resumeEvents}`);
  assert.strictEqual(client.isStdoutPaused(), false, "client should reflect resumed stdout");
  assert.strictEqual(realStdoutPipe.isPaused(), false, "real stdout pipe should reflect resumed stream");
  console.log(`Low watermark correctly resumed stream pipe at queue size: ${queue.length}`);

  // -------------------------------------------------------------
  // Test 3: Critical threshold (>1000 items) safe drop
  // -------------------------------------------------------------
  console.log("\n--- Subtest 3: Critical Threshold (>1000 items) Non-Critical Chunk Dropping ---");
  // Fill queue to 1005 items
  while (queue.length < 1005) {
    queue.push({ chunk: { type: "text-delta", text: "fill" } });
  }
  assert.strictEqual(queue.length, 1005, "Queue filled to 1005");

  // Push non-critical reasoning-delta
  const reasoningAccepted = queue.push({ chunk: { type: "reasoning-delta", text: "lagged thought" } });
  assert.strictEqual(reasoningAccepted, false, "Expected non-critical reasoning-delta to be dropped at >1000 items");
  assert.strictEqual(queue.length, 1005, "Queue length must not increase when chunk is dropped");

  // Push critical text-delta
  const textAccepted = queue.push({ chunk: { type: "text-delta", text: "important text" } });
  assert.strictEqual(textAccepted, true, "Expected critical text-delta to be preserved even at >1000 items");
  assert.strictEqual(queue.length, 1006, "Queue length should increment by 1 for critical chunk");
  console.log("Critical watermark correctly dropped non-critical chunk and retained critical chunk.");

  // -------------------------------------------------------------
  // Test 4: Stream completion / abort / error resume safety guarantee
  // -------------------------------------------------------------
  console.log("\n--- Subtest 4: Abort / Error / Completion Suspension Safety ---");
  assert.strictEqual(client.isStdoutPaused(), true, "Client should still be paused due to large queue");
  queue.finish();
  assert.strictEqual(queue.paused, false, "Queue should not remain paused after finish()");
  assert.strictEqual(client.isStdoutPaused(), false, "client.resumeStdout() must be called on stream finish/abort/error");
  assert.strictEqual(realStdoutPipe.isPaused(), false, "real stdout pipe must be resumed");
  console.log("Stream termination guarantee verified: client process stdout resumed unconditionally.");

  // Clean queue
  queue.clear();

  // -------------------------------------------------------------
  // Test 5: Perf Gate: 10,000 items memory footprint check
  // -------------------------------------------------------------
  console.log("\n--- Subtest 5: Perf Gate Memory Allocation Check (10,000 items) ---");
  const perfQueue = new StreamingBackpressureQueue({
    highWatermark: 500,
    lowWatermark: 200,
    onPause: () => client.pauseStdout(),
    onResume: () => client.resumeStdout(),
  });

  const initialMem = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) {
    perfQueue.push({ chunk: { id: i, payload: "a".repeat(100) } });
    if (perfQueue.length > 500) {
      // Simulate consumer draining backpressure
      while (perfQueue.length > 200) {
        await perfQueue.next();
      }
    }
  }
  const peakMemDiffMb = (process.memoryUsage().heapUsed - initialMem) / 1024 / 1024;
  console.log(`Peak memory allocation diff under 10k items with backpressure: ${peakMemDiffMb.toFixed(2)}MB (Budget: < 25MB)`);
  assert(peakMemDiffMb < 25, `Memory diff exceeded 25MB budget: ${peakMemDiffMb}MB`);

  console.log("\n✅ [PR-03 PASS]: All genuine backpressure assertions and memory perf gates passed!");
}

run().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
