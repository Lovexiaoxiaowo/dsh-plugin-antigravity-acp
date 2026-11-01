import { describe, it, expect, vi } from "vitest";
import { DshAntigravityService } from "../src/index";

describe("Positive DSH-to-ACP Delegation Suite", () => {
  it("Lane 25: executeDelegatedTask creates isolated session and delivers structured summary", async () => {
    const service = new DshAntigravityService({
      defaultModel: "gemini-3.8-flash",
    });

    vi.spyOn(service, "isLoggedIn").mockReturnValue(true);
    vi.spyOn(service, "initialize").mockResolvedValue();
    (service as any).client = { isPaused: false };

    const mockSessionId = "delegated-subtask-session-123";
    vi.spyOn(service, "createSession").mockResolvedValue({ sessionId: mockSessionId });
    vi.spyOn(service, "cancel").mockResolvedValue();

    vi.spyOn(service, "prompt").mockImplementation(async (sId: string) => {
      // Simulate ACP emitting subtask thinking and conclusion text
      const listeners = (service as any).notificationListeners;
      for (const [_, listener] of listeners.entries()) {
        listener({
          sessionId: sId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { text: "Investigating AST parser differences..." },
          },
        });
        listener({
          sessionId: sId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { text: "Root cause found: Unicode regex escaping error in parser." },
          },
        });
      }
      return { success: true };
    });

    const result = await service.executeDelegatedTask("Audit AST parser unicode handling", {
      model: "gemini-2.5-pro",
    });

    expect(result.success).toBe(true);
    expect(result.model).toBe("gemini-2.5-pro");
    expect(result.reasoning).toContain("Investigating AST parser differences");
    expect(result.output).toBe("Root cause found: Unicode regex escaping error in parser.");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("Lane 26: executeDelegatedTask gracefully captures timeout or error without unhandled rejection", async () => {
    const service = new DshAntigravityService();
    vi.spyOn(service, "isLoggedIn").mockReturnValue(true);
    vi.spyOn(service, "initialize").mockResolvedValue();
    (service as any).client = { isPaused: false };

    vi.spyOn(service, "createSession").mockResolvedValue({ sessionId: "timeout-session" });
    vi.spyOn(service, "cancel").mockResolvedValue();

    vi.spyOn(service, "prompt").mockImplementation(async () => {
      return new Promise((resolve) => setTimeout(resolve, 500));
    });

    const result = await service.executeDelegatedTask("Long running task", {
      timeoutMs: 50,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("执行超时");
  });
});
