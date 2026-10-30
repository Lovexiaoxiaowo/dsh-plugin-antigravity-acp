export type PermissionMode = "default" | "auto_edit" | "yolo";
export type ReasoningEffort = "low" | "medium" | "high";
export interface AntigravityPluginConfig {
    /**
     * Permission mode:
     * - "default": Ask for confirmation before any tool execution
     * - "auto_edit": Allow edits automatically, ask for shell commands
     * - "yolo": Fully autonomous execution without confirmation prompts
     */
    permissionMode?: PermissionMode;
    /**
     * Preferred model, e.g. "gemini-3.8-flash", "gemini-3.1-pro"
     */
    defaultModel?: string;
    /**
     * Reasoning effort for models that support thinking
     */
    reasoningEffort?: ReasoningEffort;
    /**
     * Custom installation directory for Antigravity runtime binary
     */
    customBinaryPath?: string;
}
export interface RuntimeReleaseAsset {
    archive: string;
    archiveSha256: string;
    archiveBytes: number;
    binaryName: "agy_acp_server.par" | "agy_acp_server.exe";
    binaryBytes: number;
    harnessName: "localharness_external" | "localharness_external.exe";
    harnessBytes: number;
    args: string[];
}
export interface RuntimeRelease {
    version: string;
    platforms: Record<string, RuntimeReleaseAsset>;
}
export interface TrustedRuntimeManifest {
    schemaVersion: 1;
    generatedAt: string;
    releases: RuntimeRelease[];
    signature: string;
}
export interface ModelOption {
    id: string;
    name: string;
    description?: string;
}
export interface AcpSessionBinding {
    dshSessionId: string;
    acpSessionId: string;
    cwd: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    lastActive: number;
    messageCount: number;
}
export interface TokenAccounting {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    totalTokens: number;
    currentContextTokens?: number;
}
export interface ModelQuotaInfo {
    remainingFraction: number;
    resetTime?: string;
}
export interface QuotaSummary {
    model: string;
    displayName: string;
    remainingFraction: number;
    remainingPercent: string;
    resetTime?: string;
    resetCountdown?: string;
    tier?: string;
    maxTokens: number;
}
export interface SessionQuotaSnapshot {
    quota?: QuotaSummary;
    sessionTokens: TokenAccounting;
    contextUsage: {
        usedTokens: number;
        maxTokens: number;
        fraction: number;
        percentage: string;
        isWarning: boolean;
    };
}
export type AcpActivity = {
    type: "text";
    delta: string;
} | {
    type: "thought";
    delta: string;
} | {
    type: "tool";
    text: string;
} | {
    type: "plan";
    text: string;
} | {
    type: "usage";
    usage: TokenAccounting;
} | {
    type: "unknown";
    updateType: string;
};
//# sourceMappingURL=types.d.ts.map