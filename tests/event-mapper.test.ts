import { describe, it, expect } from "vitest";
import { AcpStepTracker, mapSessionUpdate, DshStreamWriter } from "../src/event-mapper.js";

describe("event-mapper protocol suite", () => {
  it("Lane 1: StepTracker normalizes step numbers sequentially starting at 1", () => {
    const tracker = new AcpStepTracker();
    expect(tracker.getStepNumber("tool-a")).toBe(1);
    expect(tracker.getStepNumber("tool-b")).toBe(2);
    expect(tracker.getStepNumber("tool-c")).toBe(3);
  });

  it("Lane 2: StepTracker returns existing step number for matching toolCallId", () => {
    const tracker = new AcpStepTracker();
    expect(tracker.getStepNumber("call-123")).toBe(1);
    expect(tracker.getStepNumber("call-123")).toBe(1);
  });

  it("Lane 3: StepTracker resets step counter back to 1", () => {
    const tracker = new AcpStepTracker();
    expect(tracker.getStepNumber("call-1")).toBe(1);
    expect(tracker.getStepNumber("call-2")).toBe(2);
    tracker.reset();
    expect(tracker.getStepNumber("call-new")).toBe(1);
  });

  it("Lane 4: mapSessionUpdate parses thought/reasoning chunks", () => {
    const tracker = new AcpStepTracker();
    const notification: any = {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Analyzing directory structure..." },
      },
    };
    const activities = mapSessionUpdate(notification, tracker);
    expect(activities.length).toBe(1);
    expect(activities[0].type).toBe("thought");
    expect((activities[0] as any).delta).toBe("Analyzing directory structure...");
  });

  it("Lane 5: mapSessionUpdate maps tool call start with normalized step number", () => {
    const tracker = new AcpStepTracker();
    const notification: any = {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-xyz",
        title: "view_file",
        status: "in_progress",
        arguments: { AbsolutePath: "config.json" },
      },
    };
    const activities = mapSessionUpdate(notification, tracker);
    expect(activities.length).toBe(1);
    expect(activities[0].type).toBe("tool");
    expect((activities[0] as any).text).toContain("[步骤 #1]");
    expect((activities[0] as any).isStart).toBe(true);
  });

  it("Lane 6: mapSessionUpdate maps completed tool call status in trace", () => {
    const tracker = new AcpStepTracker();
    tracker.getStepNumber("call-xyz"); // step 1
    const notification: any = {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-xyz",
        title: "view_file",
        status: "completed",
      },
    };
    const activities = mapSessionUpdate(notification, tracker);
    expect(activities.length).toBe(1);
    expect(activities[0].type).toBe("tool");
    expect((activities[0] as any).text).toContain("[步骤 #1]");
    expect((activities[0] as any).text).toContain("completed");
  });

  it("Lane 7: mapSessionUpdate identifies subagent delegation tool call", () => {
    const tracker = new AcpStepTracker();
    const notification: any = {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "sub-1",
        title: "invoke_subagent",
        status: "in_progress",
        arguments: {
          Subagents: [{ Role: "Code Reviewer", Prompt: "Review diff" }],
        },
      },
    };
    const activities = mapSessionUpdate(notification, tracker);
    expect(activities.length).toBe(1);
    expect((activities[0] as any).isSubagent).toBe(true);
  });

  it("Lane 8: mapSessionUpdate extracts message text deltas", () => {
    const tracker = new AcpStepTracker();
    const notification: any = {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello from Gemini" },
      },
    };
    const activities = mapSessionUpdate(notification, tracker);
    expect(activities.length).toBe(1);
    expect(activities[0].type).toBe("text");
    expect((activities[0] as any).delta).toBe("Hello from Gemini");
  });

  it("Lane 9: DshStreamWriter enforces reasoning and text block lifecycle", () => {
    const chunks: any[] = [];
    const writer = new DshStreamWriter((c) => chunks.push(c));
    writer.writeThinking("Thinking step 1");
    writer.writeThinking("Thinking step 2");
    writer.writeText("Final response");
    writer.finish("stop");

    expect(chunks[0].type).toBe("block-start");
    expect(chunks[0].blockType).toBe("reasoning");
    expect(chunks[1].type).toBe("reasoning-delta");
    expect(chunks[2].type).toBe("reasoning-delta");
    expect(chunks[3].type).toBe("block-end");
    expect(chunks[4].type).toBe("block-start");
    expect(chunks[4].blockType).toBe("text");
    expect(chunks[5].type).toBe("text-delta");
    expect(chunks[6].type).toBe("block-end");
  });

  it("Lane 10: DshStreamWriter accurately tracks recorded text length", () => {
    const chunks: any[] = [];
    const writer = new DshStreamWriter((c) => chunks.push(c));
    writer.writeText("12345");
    writer.writeText("67890");
    expect(writer.getRecordedTextLength()).toBe(10);
  });

  it("Lane 11: DshStreamWriter emits clean usage block chunk", () => {
    const chunks: any[] = [];
    const writer = new DshStreamWriter((c) => chunks.push(c));
    writer.writeUsage({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      reasoningTokens: 20,
      cachedTokens: 0,
      currentContextTokens: 100,
    });
    expect(chunks.length).toBe(1);
    expect(chunks[0].type).toBe("usage");
    expect(chunks[0].usage.inputTokens).toBe(100);
    expect(chunks[0].usage.outputTokens).toBe(50);
  });

  it("Lane 12: DshStreamWriter emits tool call chunks for DSH subagent bridge", () => {
    const chunks: any[] = [];
    const writer = new DshStreamWriter((c) => chunks.push(c));
    writer.writeToolCall("call-1", "subagent", { prompt: "run task" });
    expect(chunks[0].type).toBe("block-start");
    expect(chunks[0].blockType).toBe("tool_call");
    expect(chunks[1].type).toBe("tool-call-delta");
    expect(chunks[2].type).toBe("block-end");
  });
});
