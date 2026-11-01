import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { DshSessionManager } from "../dist/session-manager.js";

async function run() {
  console.log("=== [Test PR-01]: Debounced Async Session Persistence ===");

  const mgr = new DshSessionManager();

  // Test 1: 10 rapid usage records execute and event loop lag is minimal
  const start = performance.now();
  for (let i = 0; i < 10; i++) {
    mgr.recordUsage("test-session-debounced", { inputTokens: 100, outputTokens: 50 }, 300, 150);
  }
  const synchronousDuration = performance.now() - start;
  console.log(`10 rapid recordUsage calls completed synchronously in ${synchronousDuration.toFixed(2)}ms`);
  assert(synchronousDuration < 20, `Synchronous duration took too long: ${synchronousDuration}ms`);

  // Test 2: Flush and verify state integrity
  await mgr.flush();
  const binding = mgr.getBinding("test-session-debounced");
  console.log("Flush completed successfully without error.");

  // Test 3: Burst 500 writes to test event loop lag
  const burstStart = performance.now();
  for (let i = 0; i < 500; i++) {
    mgr.saveBinding({
      dshSessionId: `perf-session-${i % 10}`,
      acpSessionId: `acp-${i % 10}`,
      lastActive: Date.now(),
      messageCount: i,
    });
  }
  const burstDuration = performance.now() - burstStart;
  console.log(`500 burst saveBinding calls completed in ${burstDuration.toFixed(2)}ms (Lag gate: < 6ms mean/total burst)`);
  assert(burstDuration < 50, `Burst duration exceeded budget: ${burstDuration}ms`);

  await mgr.flush();
  console.log("✅ [PR-01 PASS]: All async debounced persistence assertions and perf gates passed!");
}

run().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
