import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DshAntigravityService } from "../src/index";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Cancel resilience and subagent interception safety suite", () => {
  let tempDir: string;
  let service: DshAntigravityService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-cancel-test-"));
    service = new DshAntigravityService({
      defaultModel: "gemini-3.8-flash",
      reasoningEffort: "high",
    });
    // Redirect session storage to sandbox
    (service as any).sessionManager = new (service.sessionManager.constructor as any)(tempDir);
  });

  afterEach(() => {
    service.sessionManager.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Lane 20: preserves session binding when cancel occurs", async () => {
    const dshSessionId = "resilience-session-1";
    const acpSessionId = "agy-session-1";

    service.sessionManager.saveBinding({
      dshSessionId,
      acpSessionId,
      cwd: tempDir,
      model: "gemini-3.8-flash",
      reasoningEffort: "high",
      lastActive: Date.now(),
      messageCount: 1,
    });

    let cancelCalled = false;
    vi.spyOn(service as any, "cancel").mockImplementation(async (sId: string) => {
      cancelCalled = true;
      return { success: true };
    });

    await service.cancel(acpSessionId);

    // Assert: cancel was invoked
    expect(cancelCalled).toBe(true);

    // Assert: session binding is NOT removed!
    const binding = service.sessionManager.getBinding(dshSessionId);
    expect(binding).not.toBeNull();
    expect(binding?.acpSessionId).toBe(acpSessionId);
  });
});
