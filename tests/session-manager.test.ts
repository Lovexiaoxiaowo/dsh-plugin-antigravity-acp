import { describe, it, expect } from "vitest";
import { DshSessionManager } from "../src/session-manager.js";

describe("session-manager lifecycle and token suite", () => {
  it("Lane 13: saves and retrieves session binding correctly", () => {
    const mgr = new DshSessionManager();
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
    const mgr = new DshSessionManager();
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
    const mgr = new DshSessionManager();
    mgr.saveBinding({
      dshSessionId: "dsh-test-3",
      acpSessionId: "acp-test-3",
      lastActive: Date.now(),
    });
    mgr.removeBinding("dsh-test-3");
    expect(mgr.getBinding("dsh-test-3")).toBeUndefined();
  });

  it("Lane 16: calculates genuine turn tokens when input is under 1M threshold", () => {
    const mgr = new DshSessionManager();
    const usage = mgr.recordUsage("sess-token-1", { inputTokens: 450, outputTokens: 120 }, 0, 0);
    expect(usage.inputTokens).toBe(450);
    expect(usage.outputTokens).toBe(120);
    expect(usage.totalTokens).toBe(570);
  });

  it("Lane 17: discards cumulative account meter (>1M) and falls back to char estimation", () => {
    const mgr = new DshSessionManager();
    const usage = mgr.recordUsage("sess-token-2", { inputTokens: 1_500_000, outputTokens: 80 }, 700, 280);
    expect(usage.inputTokens).toBe(200);
    expect(usage.outputTokens).toBe(80);
  });

  it("Lane 18: provides safe fallback token counts when no metadata exists", () => {
    const mgr = new DshSessionManager();
    const usage = mgr.recordUsage("sess-token-3", {}, 0, 0);
    expect(usage.inputTokens).toBe(50);
    expect(usage.outputTokens).toBe(20);
  });

  it("Lane 19: strips <USER_REQUEST> tags and extracts clean user prompt", () => {
    const mgr = new DshSessionManager();
    const raw = "<USER_REQUEST>\nFix bug in parser\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\ntime=now\n</ADDITIONAL_METADATA>";
    const cleaned = mgr.cleanUserQuery(raw);
    expect(cleaned).toBe("Fix bug in parser");
  });

  it("Lane 20: identifies system injection messages correctly", () => {
    const mgr = new DshSessionManager();
    expect(mgr.isSystemInjection({ role: "system", content: "You are an agent." })).toBe(true);
    expect(mgr.isSystemInjection({ role: "developer", content: "System rule." })).toBe(true);
    expect(mgr.isSystemInjection({ role: "user", content: "Time sampled while preparing turn 1, step 1: 2026-10-31" })).toBe(true);
    expect(mgr.isSystemInjection({ role: "user", content: "Current runtime context: windows" })).toBe(true);
    expect(mgr.isSystemInjection({ role: "user", content: "Please refactor this function" })).toBe(false);
  });

  it("Lane 21: prunes internal step traces from assistant history", () => {
    const mgr = new DshSessionManager();
    const rawHistory = "I will check the files.\n> 🛠️ [步骤 #1] view_file\n> ✅ [步骤 #1 完成]\nHere is the answer.";
    const pruned = mgr.pruneAssistantHistory(rawHistory);
    expect(pruned).not.toContain("🛠️ [步骤 #1]");
    expect(pruned).toContain("Here is the answer.");
  });

  it("Lane 22: formats prompt for warm session returning authentic query only", () => {
    const mgr = new DshSessionManager();
    const messages = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ];
    const prompt = mgr.formatPromptWithHistory(messages, false);
    expect(prompt).toBe("second question");
  });

  it("Lane 23: reconstructs structured context preamble for new session with history", () => {
    const mgr = new DshSessionManager();
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
    const mgr = new DshSessionManager();
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

  it("Lane 25: flushes pending writes cleanly asynchronously and synchronously", async () => {
    const mgr = new DshSessionManager();
    mgr.saveBinding({
      dshSessionId: "flush-test",
      acpSessionId: "acp-flush",
      lastActive: Date.now(),
    });
    await mgr.flush();
    mgr.flushSync();
    expect(mgr.getBinding("flush-test")?.acpSessionId).toBe("acp-flush");
  });
});
