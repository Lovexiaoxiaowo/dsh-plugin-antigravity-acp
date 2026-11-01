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

export interface QuotaGroupItem {
  remainingFraction: number;
  remainingPercent: string;
  resetTime?: string;
  resetCountdown?: string;
  description?: string;
}

export interface QuotaCardItem {
  id: string; // "gemini-5h" | "gemini-weekly" | "claude-5h" | "claude-weekly"
  title: string; // "Gemini 3.8 / 3.5 5H", "Gemini 周配额", "Claude 4.6 / GPT 5H", "Claude 周配额"
  group: "gemini" | "claude";
  type: "5h" | "weekly";
  remainingFraction: number;
  percentage: number; // e.g. 99, 38, 100
  formattedPercent: string; // "99%", "38%", "100%"
  resetTime?: string;
  resetCountdown?: string; // "4h 51m", "4h 14m", "4d 19h"
  color: "green" | "orange" | "red";
  description?: string;
}

export interface QuotaGroupSummary {
  key: "gemini" | "claude" | "argon" | string;
  displayName: string;
  description?: string;
  supportedModels: string[];
  fiveHour?: QuotaGroupItem;
  weekly?: QuotaGroupItem;
  effectiveFraction: number;
  effectivePercent: string;
  isWeeklyExhausted: boolean;
  isWeeklyConstrained: boolean;
  is5hCooling: boolean;
}

export interface QuotaSummary {
  isStale?: boolean;
  model: string;
  displayName: string;
  accountEmail?: string;
  remainingFraction: number;
  remainingPercent: string;
  resetTime?: string;
  resetCountdown?: string;
  weeklyRemainingFraction?: number;
  weeklyRemainingPercent?: string;
  weeklyResetTime?: string;
  weeklyResetCountdown?: string;
  weeklyResetLabel?: string;
  weeklyDescription?: string;
  effectiveFraction?: number;
  effectivePercent?: string;
  isWeeklyExhausted?: boolean;
  isWeeklyConstrained?: boolean;
  is5hCooling?: boolean;
  tier?: string;
  maxTokens: number;
  cards?: QuotaCardItem[];
  groups?: QuotaGroupSummary[];
}

export interface SessionQuotaSnapshot {
  isStale?: boolean;
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

export type AcpActivity =
  | { type: "text"; delta: string }
  | { type: "thought"; delta: string }
  | {
      type: "tool";
      text: string;
      toolCallId?: string;
      name?: string;
      args?: string;
      isStart?: boolean;
      isSubagent?: boolean;
      rawArgs?: any;
    }
  | { type: "plan"; text: string }
  | { type: "usage"; usage: TokenAccounting }
  | { type: "unknown"; updateType: string };
