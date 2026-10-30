import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AcpActivity, TokenAccounting } from "./types.js";
export declare function mapSessionUpdate(notification: SessionNotification): AcpActivity[];
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
    private hasEnded;
    constructor(pushChunk: (chunk: any) => void);
    ensureReasoningOpen(): void;
    writeThinking(text: string): void;
    closeReasoningBlock(): void;
    ensureTextOpen(): void;
    writeText(text: string): void;
    closeTextBlock(): void;
    writeUsage(usage: TokenAccounting): void;
    finish(reason?: "stop" | "max-tokens" | "error"): void;
}
//# sourceMappingURL=event-mapper.d.ts.map