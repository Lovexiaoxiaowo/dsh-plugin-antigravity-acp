import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AcpActivity, TokenAccounting } from "./types.js";
/**
 * Tracks tool call steps per prompt turn.
 * Ensures the first tool call is always [步骤 #1], the second [步骤 #2], etc.,
 * normalizing Antigravity's internal step IDs (where tool calls begin at step 2 after initial thought).
 */
export declare class AcpStepTracker {
    private toolStepMap;
    private nextStep;
    getStepNumber(toolCallId: string): number;
    reset(): void;
}
export declare function mapSessionUpdate(notification: SessionNotification, stepTracker?: AcpStepTracker): AcpActivity[];
/**
 * High-reliability event writer emitting valid DSH StreamChunk sequences.
 * Guarantees proper lifecycle:
 * block-start (reasoning) -> reasoning-delta -> block-end
 * -> block-start (text) -> text-delta -> block-end
 * -> usage -> finish
 */
export declare class DshStreamWriter {
    private readonly pushChunk;
    private reasoningStarted;
    private reasoningClosed;
    private reasoningBuffer;
    private textStarted;
    private textClosed;
    private textBuffer;
    private nextBlockIndex;
    private hasEnded;
    constructor(pushChunk: (chunk: any) => void);
    getRecordedTextLength(): number;
    ensureReasoningOpen(): void;
    writeThinking(text: string): void;
    writeToolCall(id: string, name: string, args: string | Record<string, any>): void;
    closeReasoningBlock(): void;
    ensureTextOpen(): void;
    writeText(text: string): void;
    closeTextBlock(): void;
    writeUsage(usage: TokenAccounting): void;
    finish(reason?: "stop" | "max-tokens" | "error"): void;
}
//# sourceMappingURL=event-mapper.d.ts.map