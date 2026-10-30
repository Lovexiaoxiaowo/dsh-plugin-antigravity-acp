import { getFreshAccessToken } from "./auth.js";
import { DshSessionManager } from "./session-manager.js";
import type { SessionQuotaSnapshot, QuotaSummary } from "./types.js";

const DEFAULT_MAX_TOKENS = 1_000_000; // 1M tokens for Gemini 3.x models

export class AntigravityQuotaService {
  private cachedModelsData: any = null;
  private cachedTierData: any = null;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 15_000; // 15s cache

  constructor(private readonly sessionManager: DshSessionManager) {}

  private async fetchUpstreamData(): Promise<void> {
    const now = Date.now();
    if (this.cachedModelsData && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return;
    }

    const token = await getFreshAccessToken();
    if (!token) return;

    try {
      // 1. Fetch Available Models & Quota info
      const modelsPromise = fetch(
        "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "user-agent": "antigravity",
          },
          body: JSON.stringify({}),
        }
      ).then(async (r) => (r.ok ? await r.json() : null));

      // 2. Fetch User Tier info
      const tierPromise = fetch(
        "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "user-agent": "antigravity",
          },
          body: JSON.stringify({
            metadata: {
              ideType: "IDE_UNSPECIFIED",
              pluginVersion: "1.0.0",
            },
          }),
        }
      ).then(async (r) => (r.ok ? await r.json() : null));

      const [modelsData, tierData] = await Promise.all([modelsPromise, tierPromise]);

      if (modelsData?.models) {
        this.cachedModelsData = modelsData.models;
        this.lastFetchTime = now;
      }
      if (tierData) {
        this.cachedTierData = tierData;
      }
    } catch (err) {
      console.warn("[antigravity-acp] quota fetch error:", err);
    }
  }

  private formatCountdown(resetTimeStr?: string): string | undefined {
    if (!resetTimeStr) return undefined;
    const target = new Date(resetTimeStr).getTime();
    const diff = target - Date.now();
    if (diff <= 0) return "已重置";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }

  async getSnapshot(sessionId?: string, modelId: string = "gemini-3.8-flash"): Promise<SessionQuotaSnapshot> {
    await this.fetchUpstreamData();

    // Look for matching model quota or fallback to closest flash model
    const models = this.cachedModelsData || {};
    let modelEntry = models[modelId];

    if (!modelEntry) {
      for (const [k, v] of Object.entries(models)) {
        if (k.includes("flash") || k.includes("gemini")) {
          modelEntry = v;
          break;
        }
      }
    }

    const quotaInfo = modelEntry?.quotaInfo;
    const fraction = typeof quotaInfo?.remainingFraction === "number" ? quotaInfo.remainingFraction : 1.0;
    const resetTime = quotaInfo?.resetTime;
    const maxContextTokens = Number(modelEntry?.maxTokens || DEFAULT_MAX_TOKENS);

    const tierName =
      this.cachedTierData?.paidTier?.name ||
      this.cachedTierData?.currentTier?.name ||
      "Google AI";

    const quotaSummary: QuotaSummary = {
      model: modelId,
      displayName: modelEntry?.displayName || "Gemini 3.8 Flash (Antigravity)",
      remainingFraction: fraction,
      remainingPercent: `${(fraction * 100).toFixed(1)}%`,
      resetTime,
      resetCountdown: this.formatCountdown(resetTime),
      tier: tierName,
      maxTokens: maxContextTokens,
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

    const usedTokens = sessionTokens.totalTokens;
    const contextFraction = Math.min(1, usedTokens / maxContextTokens);
    const contextPercentage = `${(contextFraction * 100).toFixed(1)}%`;
    const isWarning = contextFraction >= 0.75;

    return {
      quota: quotaSummary,
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
