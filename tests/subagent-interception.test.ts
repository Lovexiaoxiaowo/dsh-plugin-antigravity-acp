import { describe, it, expect } from "vitest";
import { DshStreamWriter, mapSessionUpdate } from "../src/event-mapper";

describe("Subagent interception and multi-tool output test", () => {
  it("Lane 15: writeToolCalls emits multiple sequential tool blocks ending with finish", () => {
    const chunks: any[] = [];
    const writer = new DshStreamWriter((c) => chunks.push(c));

    const toolCalls = [
      {
        id: "call-1",
        name: "subagent",
        args: { description: "Researcher", prompt: "Research repo" },
      },
      {
        id: "call-2",
        name: "subagent",
        args: { description: "Reviewer", prompt: "Review code" },
      },
    ];

    writer.writeToolCalls(toolCalls);

    expect(chunks.length).toBe(7);
    expect(chunks[0].type).toBe("block-start");
    expect(chunks[0].index).toBe(2);
    expect(chunks[0].blockType).toBe("tool-call");

    expect(chunks[1].type).toBe("tool-call-delta");
    expect(chunks[1].id).toBe("call-1");
    expect(chunks[1].name).toBe("subagent");
    expect(JSON.parse(chunks[1].argumentsDelta).description).toBe("Researcher");

    expect(chunks[2].type).toBe("block-end");
    expect(chunks[2].index).toBe(2);

    expect(chunks[3].type).toBe("block-start");
    expect(chunks[3].index).toBe(3);

    expect(chunks[4].type).toBe("tool-call-delta");
    expect(chunks[4].id).toBe("call-2");
    expect(chunks[4].name).toBe("subagent");
    expect(JSON.parse(chunks[4].argumentsDelta).description).toBe("Reviewer");

    expect(chunks[5].type).toBe("block-end");
    expect(chunks[5].index).toBe(3);

    expect(chunks[6].type).toBe("finish");
    expect(chunks[6].reason.kind).toBe("tool-calls");
  });

  it("Lane 16: writeToolCall delegates to writeToolCalls cleanly", () => {
    const chunks: any[] = [];
    const writer = new DshStreamWriter((c) => chunks.push(c));

    writer.writeToolCall("single-call", "subagent", { prompt: "run task" });
    expect(chunks.length).toBe(4);
    expect(chunks[0].type).toBe("block-start");
    expect(chunks[1].type).toBe("tool-call-delta");
    expect(chunks[2].type).toBe("block-end");
    expect(chunks[3].type).toBe("finish");
    expect(chunks[3].reason.kind).toBe("tool-calls");
  });

  it("Lane 17: mapSessionUpdate recognizes Running invoke_subagent title as subagent", () => {
    const notice: any = {
      sessionId: "s-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-sub-1",
        title: "Running invoke_subagent",
        name: null,
        arguments: {
          Subagents: JSON.stringify([
            { Role: "DSH-Tester", Prompt: "Verify DSH UI Subagent" }
          ])
        }
      }
    };

    const activities = mapSessionUpdate(notice);
    expect(activities.length).toBe(1);
    expect(activities[0].type).toBe("tool");
    expect((activities[0] as any).isSubagent).toBe(true);
    expect((activities[0] as any).rawArgs.Subagents).toEqual([
      { Role: "DSH-Tester", Prompt: "Verify DSH UI Subagent" }
    ]);
  });

  it("Lane 18: mapSessionUpdate preserves normal run_command without false subagent match", () => {
    const notice: any = {
      sessionId: "s-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-cmd-1",
        title: "Running run_command",
        name: "run_command",
        arguments: {
          CommandLine: "echo subagent_test"
        }
      }
    };

    const activities = mapSessionUpdate(notice);
    expect(activities.length).toBe(1);
    expect(activities[0].type).toBe("tool");
    expect((activities[0] as any).isSubagent).toBe(false);
  });
});
