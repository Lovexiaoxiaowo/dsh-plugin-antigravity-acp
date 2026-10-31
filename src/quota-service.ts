import { getFreshAccessToken } from "./auth.js";
import { DshSessionManager } from "./session-manager.js";
import type { SessionQuotaSnapshot, QuotaSummary, QuotaGroupSummary, QuotaGroupItem } from "./types.js";

const DEFAULT_MAX_TOKENS = 1_000_000; // 1M tokens for Gemini 3.x models

// Fallback order: Daily -> Sandbox -> Prod (aligned with official Antigravity Language Server & Antigravity-Manager)
const FETCH_MODELS_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
];

const QUOTA_SUMMARY_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
];

const LOAD_TIER_ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
];

export class AntigravityQuotaService {
  private cachedModelsData: any = null;
  private cachedTierData: any = null;
  private cachedSummaryData: any = null;
  private lastFetchTime = 0;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private isCircuitOpen = false;
  private readonly CACHE_TTL_MS = 15_000; // 15s cache

  constructor(private readonly sessionManager: DshSessionManager) {}

  private async postWithFallback(endpoints: string[], token: string, body: any): Promise<any | null> {
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "user-agent": "antigravity",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (err) {
        // Try next fallback endpoint
      }
    }
    return null;
  }

  private async fetchUpstreamData(): Promise<void> {
    const now = Date.now();
    if (this.cachedModelsData && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return;
    }

    if (now < this.circuitOpenUntil) {
      this.isCircuitOpen = true;
      return;
    }

    const token = await getFreshAccessToken();
    if (!token) return;

    try {
      const [modelsData, tierData, summaryData] = await Promise.all([
        this.postWithFallback(FETCH_MODELS_ENDPOINTS, token, {}),
        this.postWithFallback(LOAD_TIER_ENDPOINTS, token, {
          metadata: {
            ideType: "ANTIGRAVITY",
            pluginVersion: "1.0.0",
          },
        }),
        this.postWithFallback(QUOTA_SUMMARY_ENDPOINTS, token, {}),
      ]);

      const anySuccess = Boolean(modelsData || tierData || summaryData);
      if (anySuccess) {
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = 0;
        this.isCircuitOpen = false;

        if (modelsData?.models) {
          this.cachedModelsData = modelsData.models;
          this.lastFetchTime = now;
        }
        if (tierData) {
          this.cachedTierData = tierData;
        }
        if (summaryData) {
          this.cachedSummaryData = summaryData;
        }
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 3) {
          this.circuitOpenUntil = now + 30_000;
          this.isCircuitOpen = true;
          console.warn("[antigravity-acp] quota endpoint circuit breaker open for 30s");
        }
      }
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        this.circuitOpenUntil = now + 30_000;
        this.isCircuitOpen = true;
      }
      console.warn("[antigravity-acp] quota fetch error:", err);
    }
  }

  private formatCountdown(resetTimeStr?: string): string | undefined {
    if (!resetTimeStr) return undefined;
    const target = new Date(resetTimeStr).getTime();
    const diff = target - Date.now();
    if (diff <= 0) return "已平滑恢复";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }

  private formatWeeklyCountdown(resetTimeStr?: string): string {
    if (!resetTimeStr) return "计算中";
    const target = new Date(resetTimeStr).getTime();
    const diff = target - Date.now();
    if (diff <= 0) return "已重置";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return `${days}天${hours}小时`;
    }
    return `${hours}小时${mins}分`;
  }

  private formatResetDate(resetTimeStr?: string): string {
    if (!resetTimeStr) return "自然周动态重置";
    try {
      const d = new Date(resetTimeStr);
      const month = d.getMonth() + 1;
      const date = d.getDate();
      const hours = d.getHours().toString().padStart(2, "0");
      const mins = d.getMinutes().toString().padStart(2, "0");
      return `${month}月${date}日 ${hours}:${mins}`;
    } catch {
      return "自然周动态重置";
    }
  }

  async getSnapshot(sessionId?: string, modelId: string = "gemini-3.8-flash"): Promise<SessionQuotaSnapshot> {
    await this.fetchUpstreamData();

    const models = this.cachedModelsData || {};
    const normalizedTarget = modelId.toLowerCase().replace(/[^a-z0-9]/g, "");
    let modelEntry =
      models[modelId] ||
      models[`${modelId}-tiered`] ||
      models[`${modelId}-thinking`];

    if (!modelEntry) {
      for (const [k, v] of Object.entries(models)) {
        if (k.startsWith("tab_") || k.startsWith("chat_")) continue;
        const normK = k.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normK.includes(normalizedTarget) || normalizedTarget.includes(normK)) {
          modelEntry = v;
          break;
        }
      }
    }

    if (!modelEntry) {
      for (const [k, v] of Object.entries(models)) {
        if (k.startsWith("tab_") || k.startsWith("chat_")) continue;
        if (k.includes("flash") && ((v as any).maxTokens || 0) >= 1_000_000) {
          modelEntry = v;
          break;
        }
      }
    }

    // 1. Resolve Tier identity
    const tierName =
      this.cachedTierData?.paidTier?.name ||
      this.cachedTierData?.currentTier?.name ||
      "Google AI";

    // 2. Parse Grouped Quotas from retrieveUserQuotaSummary
    const summaryGroups = this.cachedSummaryData?.groups || [];

    // Find Claude & GPT (3P) group
    const thirdPartyGroup = summaryGroups.find((g: any) => {
      const name = (g.displayName || "").toLowerCase();
      return name.includes("claude") || name.includes("gpt") || name.includes("3p");
    });
    const tp5hBucket = thirdPartyGroup?.buckets?.find((b: any) =>
      /5h|hour/i.test(`${b.window || ""} ${b.bucketId || ""}`)
    );
    const tpWeeklyBucket = thirdPartyGroup?.buckets?.find((b: any) =>
      /week|7d/i.test(`${b.window || ""} ${b.bucketId || ""}`)
    );

    // Find Gemini Group if explicitly present in summary
    const geminiGroupFromSummary = summaryGroups.find((g: any) => {
      const name = (g.displayName || "").toLowerCase();
      return !name.includes("claude") && !name.includes("gpt") && (name.includes("gemini") || !name.includes("3p"));
    });
    const summaryGemini5hBucket = geminiGroupFromSummary?.buckets?.find((b: any) =>
      /5h|hour/i.test(`${b.window || ""} ${b.bucketId || ""}`)
    );
    const summaryGeminiWeeklyBucket = geminiGroupFromSummary?.buckets?.find((b: any) =>
      /week|7d/i.test(`${b.window || ""} ${b.bucketId || ""}`)
    );

    // Global/Account Weekly Bucket fallback (weekly capacity across all groups)
    const anyWeeklyBucket =
      summaryGeminiWeeklyBucket ||
      tpWeeklyBucket ||
      summaryGroups
        .flatMap((g: any) => g.buckets || [])
        .find((b: any) => /week|7d/i.test(`${b.window || ""} ${b.bucketId || ""}`));

    // Gemini 5h quota from model or summary
    const geminiModelQuotaInfo = modelEntry?.quotaInfo;
    const gemini5hFraction =
      typeof geminiModelQuotaInfo?.remainingFraction === "number"
        ? geminiModelQuotaInfo.remainingFraction
        : typeof summaryGemini5hBucket?.remainingFraction === "number"
        ? summaryGemini5hBucket.remainingFraction
        : 1.0;
    const gemini5hReset = geminiModelQuotaInfo?.resetTime || summaryGemini5hBucket?.resetTime;

    // Gemini Weekly quota
    const geminiWeeklyFraction =
      typeof summaryGeminiWeeklyBucket?.remainingFraction === "number"
        ? summaryGeminiWeeklyBucket.remainingFraction
        : typeof anyWeeklyBucket?.remainingFraction === "number"
        ? anyWeeklyBucket.remainingFraction
        : 1.0;
    const geminiWeeklyReset = summaryGeminiWeeklyBucket?.resetTime || anyWeeklyBucket?.resetTime;
    const geminiWeeklyDesc = summaryGeminiWeeklyBucket?.description || anyWeeklyBucket?.description;

    // Claude & GPT 5h & Weekly
    const tp5hFraction = typeof tp5hBucket?.remainingFraction === "number" ? tp5hBucket.remainingFraction : 1.0;
    const tp5hReset = tp5hBucket?.resetTime;
    const tpWeeklyFraction =
      typeof tpWeeklyBucket?.remainingFraction === "number"
        ? tpWeeklyBucket.remainingFraction
        : typeof anyWeeklyBucket?.remainingFraction === "number"
        ? anyWeeklyBucket.remainingFraction
        : 1.0;
    const tpWeeklyReset = tpWeeklyBucket?.resetTime || anyWeeklyBucket?.resetTime;
    const tpWeeklyDesc = tpWeeklyBucket?.description || anyWeeklyBucket?.description;

    // 3. Constrained Quota (Wood Barrel Short-board Logic) for Active Model
    const isWeeklyExhausted = geminiWeeklyFraction <= 0.001;
    const is5hCooling = gemini5hFraction <= 0.001 && geminiWeeklyFraction > 0.001;
    const isWeeklyConstrained = isWeeklyExhausted || geminiWeeklyFraction < gemini5hFraction;
    const effectiveFraction = isWeeklyExhausted ? 0 : Math.min(gemini5hFraction, geminiWeeklyFraction);
    const effectivePercent = `${(effectiveFraction * 100).toFixed(1)}%`;

    const maxContextTokens = Number(modelEntry?.maxTokens || DEFAULT_MAX_TOKENS);

    // Build Model Groups array
    const groups: QuotaGroupSummary[] = [
      {
        key: "gemini",
        displayName: "Gemini 官方模型池",
        description: "Gemini 3.8 Flash, 2.5 Pro, 2.5 Flash, 3.1 Image 等官方核心模型",
        supportedModels: [
          "Gemini 3.8 Flash",
          "Gemini 2.5 Pro",
          "Gemini 2.5 Flash",
          "Gemini 3.1 Flash Image",
          "Gemini 2.5 Thinking",
          "Gemini 3.5 Flash-Lite",
        ],
        fiveHour: {
          remainingFraction: gemini5hFraction,
          remainingPercent: `${(gemini5hFraction * 100).toFixed(1)}%`,
          resetTime: gemini5hReset,
          resetCountdown: this.formatCountdown(gemini5hReset),
        },
        weekly: {
          remainingFraction: geminiWeeklyFraction,
          remainingPercent: `${(geminiWeeklyFraction * 100).toFixed(1)}%`,
          resetTime: geminiWeeklyReset,
          resetCountdown: this.formatWeeklyCountdown(geminiWeeklyReset),
          description: geminiWeeklyDesc,
        },
        effectiveFraction,
        effectivePercent,
        isWeeklyExhausted,
        isWeeklyConstrained,
        is5hCooling,
      },
      {
        key: "claude",
        displayName: "Claude & GPT 托管模型池",
        description: "Claude Opus 4.6 Thinking, Claude Sonnet 4.6, GPT-OSS 120B",
        supportedModels: [
          "Claude Opus 4.6 Thinking",
          "Claude Sonnet 4.6",
          "GPT-OSS 120B Medium",
        ],
        fiveHour: {
          remainingFraction: tp5hFraction,
          remainingPercent: `${(tp5hFraction * 100).toFixed(1)}%`,
          resetTime: tp5hReset,
          resetCountdown: this.formatCountdown(tp5hReset),
        },
        weekly: {
          remainingFraction: tpWeeklyFraction,
          remainingPercent: `${(tpWeeklyFraction * 100).toFixed(1)}%`,
          resetTime: tpWeeklyReset,
          resetCountdown: this.formatWeeklyCountdown(tpWeeklyReset),
          description: tpWeeklyDesc,
        },
        effectiveFraction: tpWeeklyFraction <= 0.001 ? 0 : Math.min(tp5hFraction, tpWeeklyFraction),
        effectivePercent: `${(Math.min(tp5hFraction, tpWeeklyFraction) * 100).toFixed(1)}%`,
        isWeeklyExhausted: tpWeeklyFraction <= 0.001,
        isWeeklyConstrained: tpWeeklyFraction < tp5hFraction,
        is5hCooling: tp5hFraction <= 0.001 && tpWeeklyFraction > 0.001,
      },
    ];

    const quotaSummary: QuotaSummary = {
      model: modelId,
      displayName: modelEntry?.displayName || "Gemini 3.8 Flash (Antigravity)",
      remainingFraction: gemini5hFraction,
      remainingPercent: `${(gemini5hFraction * 100).toFixed(1)}%`,
      resetTime: gemini5hReset,
      resetCountdown: this.formatCountdown(gemini5hReset),
      weeklyRemainingFraction: geminiWeeklyFraction,
      weeklyRemainingPercent: `${(geminiWeeklyFraction * 100).toFixed(1)}%`,
      weeklyResetTime: geminiWeeklyReset,
      weeklyResetCountdown: this.formatWeeklyCountdown(geminiWeeklyReset),
      weeklyResetLabel: this.formatResetDate(geminiWeeklyReset),
      weeklyDescription: geminiWeeklyDesc,
      effectiveFraction,
      effectivePercent,
      isWeeklyExhausted,
      isWeeklyConstrained,
      is5hCooling,
      tier: tierName,
      maxTokens: maxContextTokens,
      groups,
      isStale: this.isCircuitOpen || (Date.now() - this.lastFetchTime > 60_000),
    };

    // Session token accounting and context calculation
    const sessionTokens = sessionId
      ? this.sessionManager.getUsage(sessionId)
      : {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
        };

    const activeContext =
      sessionTokens.currentContextTokens ||
      (sessionTokens.inputTokens > 0 ? sessionTokens.inputTokens : sessionTokens.totalTokens);
    const usedTokens = activeContext;
    const contextFraction = Math.min(1, usedTokens / maxContextTokens);
    const contextPercentage = `${(contextFraction * 100).toFixed(1)}%`;
    const isWarning = contextFraction >= 0.75;

    return {
      quota: quotaSummary,
      isStale: this.isCircuitOpen || (Date.now() - this.lastFetchTime > 60_000),
      sessionTokens,
      contextUsage: {
        usedTokens,
        maxTokens: maxContextTokens,
        fraction: contextFraction,
        percentage: contextPercentage,
        isWarning,
      },
    };
  }
}
