import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DshSessionManager } from "../src/session-manager.js";

describe("session-manager lifecycle and token suite (Sandboxed)", () => {
  let sandboxDir: string;
  let mgr: DshSessionManager;

  beforeEach(() => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-test-sessions-"));
    mgr = new DshSessionManager(sandboxDir);
  });

  afterEach(() => {
    mgr.dispose();
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  it("Lane 13: saves and retrieves session binding correctly", () => {
    mgr.saveBinding({
      dshSessionId: "dsh-test-1",
      acpSessionId: "acp-test-1",
      lastActive: Date.now(),
      messageCount: 1,
    });
    const binding = mgr.getBinding("dsh-test-1");
    expect(binding).toBeDefined();
    expect(binding?.acpSessionId).toBe("acp-test-1");
    expect(binding?.messageCount).toBe(1);
  });

  it("Lane 14: increments message count accurately", () => {
    mgr.saveBinding({
      dshSessionId: "dsh-test-2",
      acpSessionId: "acp-test-2",
      lastActive: Date.now(),
      messageCount: 5,
    });
    mgr.incrementMessageCount("dsh-test-2");
    expect(mgr.getBinding("dsh-test-2")?.messageCount).toBe(6);
  });

  it("Lane 15: removes binding cleanly", () => {
    mgr.saveBinding({
      dshSessionId: "dsh-test-3",
      acpSessionId: "acp-test-3",
      lastActive: Date.now(),
    });
    mgr.removeBinding("dsh-test-3");
    expect(mgr.getBinding("dsh-test-3")).toBeUndefined();
  });

  it("Lane 16: calculates genuine turn tokens when input is under 1M threshold", () => {
    const usage = mgr.recordUsage("sess-token-1", { inputTokens: 450, outputTokens: 120 }, 0, 0);
    expect(usage.inputTokens).toBe(450);
    expect(usage.outputTokens).toBe(120);
    expect(usage.totalTokens).toBe(570);
  });

  it("Lane 17: discards cumulative account meter (>1M) and falls back to char estimation", () => {
    const usage = mgr.recordUsage("sess-token-2", { inputTokens: 1_500_000, outputTokens: 80 }, 700, 280);
    expect(usage.inputTokens).toBe(200);
    expect(usage.outputTokens).toBe(80);
  });

  it("Lane 18: provides safe fallback token counts when no metadata exists", () => {
    const usage = mgr.recordUsage("sess-token-3", {}, 0, 0);
    expect(usage.inputTokens).toBe(50);
    expect(usage.outputTokens).toBe(20);
  });

  it("Lane 19: strips <USER_REQUEST> tags and extracts clean user prompt", () => {
    const raw = "<USER_REQUEST>\nFix bug in parser\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\ntime=now\n</ADDITIONAL_METADATA>";
    const cleaned = mgr.cleanUserQuery(raw);
    expect(cleaned).toBe("Fix bug in parser");
  });

  it("Lane 20: identifies system injection messages correctly", () => {
    expect(mgr.isSystemInjection({ role: "system", content: "You are an agent." })).toBe(true);
    expect(mgr.isSystemInjection({ role: "developer", content: "System rule." })).toBe(true);
    expect(mgr.isSystemInjection({ role: "user", content: "Time sampled while preparing turn 1, step 1: 2026-10-31" })).toBe(true);
    expect(mgr.isSystemInjection({ role: "user", content: "Current runtime context: windows" })).toBe(true);
    expect(mgr.isSystemInjection({ role: "user", content: "Please refactor this function" })).toBe(false);
  });

  it("Lane 21: prunes internal step traces from assistant history", () => {
    const rawHistory = "I will check the files.\n> 🛠️ [步骤 #1] view_file\n> ✅ [步骤 #1 完成]\nHere is the answer.";
    const pruned = mgr.pruneAssistantHistory(rawHistory);
    expect(pruned).not.toContain("🛠️ [步骤 #1]");
    expect(pruned).toContain("Here is the answer.");
  });

  it("Lane 22: formats prompt for warm session returning authentic query only", () => {
    const messages = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ];
    const prompt = mgr.formatPromptWithHistory(messages, false);
    expect(prompt).toBe("second question");
  });

  it("Lane 23: reconstructs structured context preamble for new session with history", () => {
    const messages = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ];
    const prompt = mgr.formatPromptWithHistory(messages, true);
    expect(prompt).toContain("=== [Context Reconstruction: Conversation History] ===");
    expect(prompt).toContain("[User]:\nfirst question");
    expect(prompt).toContain("[Assistant]:\nfirst answer");
    expect(prompt).toContain("=== [Current Turn: User Query] ===");
    expect(prompt).toContain("second question");
  });

  it("Lane 24: extracts multimodal content blocks (text and image)", async () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "Look at this screenshot:" },
        { type: "image", data: "iVBORw0KGgoAAAANSUhEUg==", mimeType: "image/png" },
      ],
    };
    const blocks = await mgr.extractContentBlocks(msg);
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("text");
    expect((blocks[0] as any).text).toContain("Look at this screenshot:");
    expect(blocks[1].type).toBe("image");
    expect((blocks[1] as any).data).toBe("iVBORw0KGgoAAAANSUhEUg==");
  });

  it("Lane 25: flushes pending writes cleanly asynchronously and writes real disk files", async () => {
    mgr.saveBinding({
      dshSessionId: "flush-disk-test",
      acpSessionId: "acp-disk-1",
      lastActive: 123456789,
      messageCount: 3,
    });
    // Async flush
    await mgr.flush();

    // Verify physical file was genuinely created on disk and parseable!
    const sessionsFile = path.join(sandboxDir, "sessions.json");
    expect(fs.existsSync(sessionsFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((b: any) => b.dshSessionId === "flush-disk-test" && b.acpSessionId === "acp-disk-1")).toBe(true);

    // Verify reload from a fresh manager instance reads the persisted data from disk
    const freshMgr = new DshSessionManager(sandboxDir);
    expect(freshMgr.getBinding("flush-disk-test")?.acpSessionId).toBe("acp-disk-1");
    freshMgr.dispose();
  });
  it("Lane 26: computes disjoint cached tokens for multi-turn warm session and explicit cached tokens", () => {
    // Cold session without cache
    const cold = mgr.recordUsage("sess-cache-1", { inputTokens: 500, outputTokens: 100 }, 100, 0);
    expect(cold.cachedTokens).toBe(0);
    expect(cold.inputTokens).toBe(500);

    // Multi-turn warm session: prior context is cached
    mgr.saveBinding({
      dshSessionId: "sess-cache-2",
      acpSessionId: "acp-cache-2",
      lastActive: Date.now(),
      messageCount: 3,
    });
    // Context tokens established in step 1
    mgr.recordUsage("sess-cache-2", { inputTokens: 1000, outputTokens: 200 }, 100, 0);
    // Turn 2: input is 1200, new query is ~50 chars (~15 tokens)
    const warm = mgr.recordUsage("sess-cache-2", { inputTokens: 1200, outputTokens: 150 }, 50, 0);
    expect(warm.cachedTokens).toBeGreaterThan(0);
    expect(warm.inputTokens).toBeLessThan(1200);
    expect(warm.inputTokens + warm.cachedTokens).toBe(1200);

    // Explicit cached tokens from Gemini metadata
    const explicit = mgr.recordUsage("sess-cache-3", {
      inputTokens: 800,
      outputTokens: 100,
      cachedTokens: 600,
    }, 0, 0);
    expect(explicit.cachedTokens).toBe(600);
    expect(explicit.inputTokens).toBe(200);
    expect(explicit.totalTokens).toBe(900);
  });
});
