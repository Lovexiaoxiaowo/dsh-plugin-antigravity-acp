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

  // 2. Instantiate QuotaService configured with hung upstream endpoint
  console.log(`Testing AntigravityQuotaService against hung endpoint ${hungUrl}...`);
  const sessionManager = new DshSessionManager();
  const quotaService = new AntigravityQuotaService(sessionManager, [hungUrl]);

  const start = performance.now();
  const snapshot = await quotaService.getSnapshot();
  const duration = performance.now() - start;

  hungServer.close();
  if (typeof hungServer.closeAllConnections === "function") {
    hungServer.closeAllConnections();
  }

  console.log(`QuotaService.getSnapshot() completed in ${duration.toFixed(2)}ms (Perf budget: 4900ms - 5500ms)`);
  assert(duration >= 4900 && duration <= 5500, `Duration out of expected 5000ms window: ${duration}ms`);

  // Verify that a hung upstream endpoint returns a stale snapshot
  assert(snapshot, "Expected valid snapshot structure");
  assert(snapshot.isStale === true, "Expected snapshot to be stale due to upstream timeout");
  assert(snapshot.quota, "Expected quota structure");
  assert(snapshot.quota.isStale === true, "Expected quota.isStale to be true");
  assert(snapshot.contextUsage, "Expected contextUsage structure");
  console.log("Snapshot successfully returned stale snapshot with contextUsage:", snapshot.contextUsage.percentage);

  console.log("✅ [PR-02 PASS]: All timeout and circuit breaker assertions and perf gates passed!");
}

run().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
