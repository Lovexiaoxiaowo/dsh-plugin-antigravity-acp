import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DshSessionManager } from "../src/session-manager";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Tool result payload backfill suite", () => {
  let tempDir: string;
  let manager: DshSessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-tool-test-"));
    manager = new DshSessionManager(tempDir);
  });

  afterEach(() => {
    manager.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Lane 17: warm session delivers tool execution results directly to ACP", async () => {
    const messages = [
      { role: "user", content: "Optimize database performance" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "call-db-1",
            name: "subagent",
            arguments: JSON.stringify({ prompt: "Check slow query logs" }),
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-db-1",
        toolName: "subagent",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-db-1",
            result: "Found 3 slow queries in orders table missing index on created_at",
          },
        ],
      },
    ];

    const payload = await manager.preparePromptPayload(messages, false);
    expect(payload.length).toBe(1);
    expect(payload[0].type).toBe("text");
    const text = (payload[0] as any).text;
    expect(text).toContain("[Tool Execution Result for subagent (call-db-1)]:");
    expect(text).toContain("Found 3 slow queries in orders table missing index on created_at");
  });

  it("Lane 18: cold/new session reconstructs history with tool execution results block", async () => {
    const messages = [
      { role: "user", content: "Audit project dependencies" },
      { role: "assistant", content: "I will check npm packages." },
      {
        role: "tool",
        toolCallId: "sub-audit-1",
        name: "subagent",
        content: "Found 0 vulnerabilities, all dependencies are up to date.",
      },
    ];

    const payload = await manager.preparePromptPayload(messages, true);
    expect(payload.length).toBe(1);
    const text = (payload[0] as any).text;
    expect(text).toContain("=== [Context Reconstruction: Conversation History] ===");
    expect(text).toContain("[User]:\nAudit project dependencies");
    expect(text).toContain("=== [Current Turn: Tool Execution Results] ===");
    expect(text).toContain("[Tool Execution Result for subagent (sub-audit-1)]:");
    expect(text).toContain("Found 0 vulnerabilities, all dependencies are up to date.");
  });

  it("Lane 19: formats multiple parallel subagent tool results seamlessly", async () => {
    const messages = [
      { role: "user", content: "Analyze backend and frontend" },
      {
        role: "tool",
        toolCallId: "sub-1",
        toolName: "subagent",
        content: "Backend analysis: Go microservices healthy",
      },
      {
        role: "tool",
        toolCallId: "sub-2",
        toolName: "subagent",
        content: "Frontend analysis: Vite build is green",
      },
    ];

    const promptText = manager.findRealUserPrompt(messages);
    expect(promptText).toContain("[Tool Execution Result for subagent (sub-1)]:\nBackend analysis: Go microservices healthy");
    expect(promptText).toContain("[Tool Execution Result for subagent (sub-2)]:\nFrontend analysis: Vite build is green");
  });
});
