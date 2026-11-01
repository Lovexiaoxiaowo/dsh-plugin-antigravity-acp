import { describe, it, expect } from "vitest";
import { DshStreamWriter } from "../src/event-mapper";

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

    // Block structure:
    // call-1:
    // 0: block-start (index: 2, tool_call)
    // 1: tool-call-delta (index: 2, call-1)
    // 2: block-end (index: 2)
    // call-2:
    // 3: block-start (index: 3, tool_call)
    // 4: tool-call-delta (index: 3, call-2)
    // 5: block-end (index: 3)
    // 6: finish (kind: tool_calls)
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
});
