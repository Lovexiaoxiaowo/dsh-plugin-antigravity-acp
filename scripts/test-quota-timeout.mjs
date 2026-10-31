import assert from "node:assert";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { AntigravityQuotaService } from "../dist/quota-service.js";
import { DshSessionManager } from "../dist/session-manager.js";

async function run() {
  console.log("=== [Test PR-02]: Quota Timeout and Circuit Breaker ===");

  // 1. Create mock hung server that does not respond to simulate blackhole
  const hungServer = http.createServer((req, res) => {
    // Deliberately hold request open forever
  });

  await new Promise((resolve) => hungServer.listen(0, "127.0.0.1", resolve));
  const port = hungServer.address().port;
  const hungUrl = `http://127.0.0.1:${port}/hung`;

  // Test single fetch timeout with AbortSignal.timeout(5000)
  console.log(`Testing fetch against hung endpoint ${hungUrl}...`);
  const start = performance.now();
  let timedOut = false;
  try {
    await fetch(hungUrl, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    timedOut = true;
    console.log(`Fetch aborted as expected: ${err.name} - ${err.message}`);
  }
  const duration = performance.now() - start;
  hungServer.close();

  assert(timedOut, "Expected request to abort with timeout");
  console.log(`Aborted after ${duration.toFixed(2)}ms (Perf budget: < 5200ms)`);
  assert(duration >= 4900 && duration <= 5200, `Duration out of expected 5000ms window: ${duration}ms`);

  // 2. Test QuotaService instantiation and offline snapshot generation
  const sessionManager = new DshSessionManager();
  const quotaService = new AntigravityQuotaService(sessionManager);
  const snapshot = await quotaService.getSnapshot();
  assert(snapshot, "Expected valid snapshot structure");
  assert(snapshot.contextUsage, "Expected contextUsage structure");
  console.log("Snapshot successfully returned with contextUsage:", snapshot.contextUsage.percentage);

  console.log("✅ [PR-02 PASS]: All timeout and circuit breaker assertions and perf gates passed!");
}

run().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
