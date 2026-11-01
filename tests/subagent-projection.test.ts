import { describe, it, expect } from "vitest";
import { extractSubagentPayload, mapSessionUpdate, AcpStepTracker } from "../src/event-mapper.js";

describe("Subagent Schema Type Guard & Projection Suite", () => {
  it("Lane 1: extracts subagents when title is human-readable action and rawInput has Subagents array", () => {
    const update = {
      sessionUpdate: "tool_call",
      toolCallId: "call-review-1",
      title: "Spawn parallel code-review subagents",
      status: "in_progress",
      rawInput: {
        Subagents: [
          { Role: "Standards Reviewer", Prompt: "Review Fowler code smells" },
          { Role: "Spec Reviewer", Prompt: "Review test alignment" },
        ],
        toolAction: "Spawning review subagents",
        toolSummary: "Spawn parallel code-review subagents",
      },
    };

    const payload = extractSubagentPayload(update);
    expect(payload).not.toBeNull();
    expect(payload?.tasks.length).toBe(2);
    expect(payload?.tasks[0].Role).toBe("Standards Reviewer");
    expect(payload?.tasks[1].Role).toBe("Spec Reviewer");
  });

  it("Lane 2: extracts subagents when name is invoke_subagent with arguments fallback", () => {
    const update = {
      sessionUpdate: "tool_call",
      toolCallId: "call-legacy-1",
      name: "invoke_subagent",
      arguments: {
        Subagents: [
          { Role: "Researcher", Prompt: "Search documentation" },
        ],
      },
    };

    const payload = extractSubagentPayload(update);
    expect(payload).not.toBeNull();
    expect(payload?.tasks.length).toBe(1);
    expect(payload?.tasks[0].Role).toBe("Researcher");
  });

  it("Lane 3: returns null for normal tools without subagent signature", () => {
    const update = {
      sessionUpdate: "tool_call",
      toolCallId: "call-view-1",
      title: "view_file",
      rawInput: { AbsolutePath: "src/index.ts" },
    };

    const payload = extractSubagentPayload(update);
    expect(payload).toBeNull();
  });

  it("Lane 4: mapSessionUpdate sets isSubagent true and binds subagentPayload on matching schema", () => {
    const tracker = new AcpStepTracker();
    const notification: any = {
      sessionId: "session-abc",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "sub-99",
        title: "Spawning review subagents",
        rawInput: {
          Subagents: [
            { Role: "Auditor", Prompt: "Verify invariants" },
          ],
        },
      },
    };

    const activities = mapSessionUpdate(notification, tracker);
    expect(activities.length).toBe(1);
    const act = activities[0] as any;
    expect(act.type).toBe("tool");
    expect(act.isSubagent).toBe(true);
    expect(act.subagentPayload).toBeDefined();
    expect(act.subagentPayload.tasks[0].Role).toBe("Auditor");
    expect(act.text).toContain("🤖 [步骤 #1] 派发独立子任务");
  });
  it("Lane 5: parses stringified JSON Subagents and tolerates descriptive action titles", () => {
    const update = {
      sessionUpdate: "tool_call",
      toolCallId: "sub-str-1",
      title: "Invoke subagent for package inspection",
      rawInput: {
        toolAction: "Invoking test subagent",
        toolSummary: "Invoke subagent for package inspection",
        Subagents: JSON.stringify([
          { Role: "Package Inspector", Prompt: "Inspect package.json" },
        ]),
      },
    };

    const payload = extractSubagentPayload(update);
    expect(payload).not.toBeNull();
    expect(payload?.tasks.length).toBe(1);
    expect(payload?.tasks[0].Role).toBe("Package Inspector");
    expect(payload?.tasks[0].Prompt).toBe("Inspect package.json");
  });

  it("Lane 6: handles swarm tasks array containing string slices", () => {
    const update = {
      sessionUpdate: "tool_call",
      toolCallId: "sub-swarm-1",
      name: "swarm",
      arguments: {
        brief: "Audit security invariants",
        tasks: ["slice-auth.ts", "slice-crypto.ts"],
      },
    };

    const payload = extractSubagentPayload(update);
    expect(payload).not.toBeNull();
    expect(payload?.tasks.length).toBe(2);
    expect(payload?.tasks[0].Prompt).toBe("slice-auth.ts");
    expect(payload?.tasks[1].Prompt).toBe("slice-crypto.ts");
  });
});
