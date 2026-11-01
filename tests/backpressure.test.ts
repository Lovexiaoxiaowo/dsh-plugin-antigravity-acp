import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { AntigravityAcpClient } from "../src/acp-client.js";
import { StreamingBackpressureQueue } from "../src/index.js";

describe("Streaming Backpressure & Pipe Control", () => {
  it("AntigravityAcpClient pauseStdout and resumeStdout directly pause and resume stdout stream", () => {
    const client = new AntigravityAcpClient("fake-path");
    const stream = new PassThrough();
    client.attachProcess({ stdout: stream, kill: () => {} });

    expect(client.isStdoutPaused()).toBe(false);
    expect(stream.isPaused()).toBe(false);

    client.pauseStdout();
    expect(client.isStdoutPaused()).toBe(true);
    expect(stream.isPaused()).toBe(true);

    client.resumeStdout();
    expect(client.isStdoutPaused()).toBe(false);
    expect(stream.isPaused()).toBe(false);
  });

  it("StreamingBackpressureQueue triggers pause at HIGH_WATERMARK (500) and resume at LOW_WATERMARK (200)", async () => {
    let paused = false;
    let resumed = false;

    const queue = new StreamingBackpressureQueue({
      highWatermark: 500,
      lowWatermark: 200,
      criticalWatermark: 1000,
      onPause: () => {
        paused = true;
      },
      onResume: () => {
        resumed = true;
      },
    });

    for (let i = 0; i < 500; i++) {
      queue.push({ chunk: { type: "text-delta", text: `t-${i}` } });
    }

    expect(paused).toBe(true);
    expect(queue.paused).toBe(true);
    expect(queue.length).toBe(500);

    while (queue.length > 200) {
      await queue.next();
    }
    expect(resumed).toBe(true);
    expect(queue.paused).toBe(false);
  });

  it("StreamingBackpressureQueue drops reasoning-delta when length exceeds CRITICAL_WATERMARK (1000)", () => {
    const queue = new StreamingBackpressureQueue({
      criticalWatermark: 1000,
    });

    for (let i = 0; i < 1000; i++) {
      queue.push({ chunk: { type: "text-delta", text: `item-${i}` } });
    }
    expect(queue.length).toBe(1000);

    // Drop non-critical reasoning-delta
    const reasoningAccepted = queue.push({ chunk: { type: "reasoning-delta", text: "thought" } });
    expect(reasoningAccepted).toBe(false);
    expect(queue.length).toBe(1000);

    // Keep critical text-delta
    const textAccepted = queue.push({ chunk: { type: "text-delta", text: "answer" } });
    expect(textAccepted).toBe(true);
    expect(queue.length).toBe(1001);
  });

  it("StreamingBackpressureQueue finish() resumes paused state", () => {
    let resumed = false;
    const queue = new StreamingBackpressureQueue({
      highWatermark: 10,
      onPause: () => {},
      onResume: () => {
        resumed = true;
      },
    });

    for (let i = 0; i < 15; i++) {
      queue.push({ chunk: { type: "text-delta", text: "fill" } });
    }
    expect(queue.paused).toBe(true);

    queue.finish();
    expect(queue.paused).toBe(false);
    expect(resumed).toBe(true);
  });
});
