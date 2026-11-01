import type { ReasoningEffort } from "./types.js";
/**
 * Checks whether a given model identifier is a third-party non-Gemini model (e.g. Claude, GPT-OSS)
 * that is blocked by the local agy_acp_server binary under free-tier and must be called via
 * direct Google Antigravity streaming endpoints.
 */
export declare function isThirdPartyModel(modelId?: string): boolean;
/**
 * Streams prompts directly against Google Antigravity Daily upstream endpoints (cloudcode-pa / Vertex AI),
 * perfectly matching Antigravity-Manager proxy architecture.
 *
 * Supports:
 * - Claude Opus 4.6 (Thinking) with real-time thought chunks and output chunks
 * - Claude Sonnet 4.6
 * - GPT-OSS 120B
 */
export declare function streamDirectApiPrompt(input: string | any[], options: {
    signal?: AbortSignal;
    model: string;
    reasoningEffort?: ReasoningEffort;
    resolveAttachment?: (ref: any) => Promise<{
        data: string;
        mimeType: string;
    } | null>;
}): AsyncIterable<any>;
//# sourceMappingURL=direct-client.d.ts.map