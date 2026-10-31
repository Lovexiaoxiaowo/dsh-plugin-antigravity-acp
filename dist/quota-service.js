import { getFreshAccessToken } from "./auth.js";
const DEFAULT_MAX_TOKENS = 1_000_000; // 1M tokens for Gemini 3.x models
export class AntigravityQuotaService {
    sessionManager;
    cachedModelsData = null;
    cachedTierData = null;
    lastFetchTime = 0;
    CACHE_TTL_MS = 15_000; // 15s cache
    constructor(sessionManager) {
        this.sessionManager = sessionManager;
    }
    async fetchUpstreamData() {
        const now = Date.now();
        if (this.cachedModelsData && now - this.lastFetchTime < this.CACHE_TTL_MS) {
            return;
        }
        const token = await getFreshAccessToken();
        if (!token)
            return;
        try {
            // 1. Fetch Available Models & Quota info
            const modelsPromise = fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                    "user-agent": "antigravity",
                },
                body: JSON.stringify({}),
            }).then(async (r) => (r.ok ? await r.json() : null));
            // 2. Fetch User Tier info
            const tierPromise = fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
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
            }).then(async (r) => (r.ok ? await r.json() : null));
            const [modelsData, tierData] = await Promise.all([modelsPromise, tierPromise]);
            if (modelsData?.models) {
                this.cachedModelsData = modelsData.models;
                this.lastFetchTime = now;
            }
            if (tierData) {
                this.cachedTierData = tierData;
            }
        }
        catch (err) {
            console.warn("[antigravity-acp] quota fetch error:", err);
        }
    }
    formatCountdown(resetTimeStr) {
        if (!resetTimeStr)
            return undefined;
        const target = new Date(resetTimeStr).getTime();
        const diff = target - Date.now();
        if (diff <= 0)
            return "已重置";
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);
        const pad = (n) => n.toString().padStart(2, "0");
        return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    }
    getWeeklyResetInfo() {
        const now = new Date();
        // Google Cloud / Antigravity 官方自然周结算点：每周一 00:00:00 UTC (北京时间周一 08:00)
        const nextMonday = new Date(now.getTime());
        const currentDay = nextMonday.getUTCDay(); // 0 is Sunday, 1 is Monday...
        const daysUntilMonday = (8 - currentDay) % 7 || 7;
        nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
        nextMonday.setUTCHours(0, 0, 0, 0);
        const diff = nextMonday.getTime() - now.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return {
            weeklyResetTime: nextMonday.toISOString(),
            weeklyResetCountdown: `${days}天${hours}小时${mins}分`,
            weeklyResetLabel: "每周一 08:00 (UTC+8)",
        };
    }
    async getSnapshot(sessionId, modelId = "gemini-3.8-flash") {
        await this.fetchUpstreamData();
        // Look for matching model quota or fallback to closest flash model
        const models = this.cachedModelsData || {};
        const normalizedTarget = modelId.toLowerCase().replace(/[^a-z0-9]/g, "");
        let modelEntry = models[modelId] ||
            models[`${modelId}-tiered`] ||
            models[`${modelId}-thinking`];
        if (!modelEntry) {
            for (const [k, v] of Object.entries(models)) {
                if (k.startsWith("tab_") || k.startsWith("chat_"))
                    continue; // Skip tab completion models
                const normK = k.toLowerCase().replace(/[^a-z0-9]/g, "");
                if (normK.includes(normalizedTarget) || normalizedTarget.includes(normK)) {
                    modelEntry = v;
                    break;
                }
            }
        }
        if (!modelEntry) {
            for (const [k, v] of Object.entries(models)) {
                if (k.startsWith("tab_") || k.startsWith("chat_"))
                    continue;
                if (k.includes("flash") && (v.maxTokens || 0) >= 1_000_000) {
                    modelEntry = v;
                    break;
                }
            }
        }
        const quotaInfo = modelEntry?.quotaInfo;
        const fraction = typeof quotaInfo?.remainingFraction === "number" ? quotaInfo.remainingFraction : 1.0;
        const resetTime = quotaInfo?.resetTime;
        const maxContextTokens = Number(modelEntry?.maxTokens || DEFAULT_MAX_TOKENS);
        const tierName = this.cachedTierData?.paidTier?.name ||
            this.cachedTierData?.currentTier?.name ||
            "Google AI";
        const weeklyInfo = this.getWeeklyResetInfo();
        const quotaSummary = {
            model: modelId,
            displayName: modelEntry?.displayName || "Gemini 3.8 Flash (Antigravity)",
            remainingFraction: fraction,
            remainingPercent: `${(fraction * 100).toFixed(1)}%`,
            resetTime,
            resetCountdown: this.formatCountdown(resetTime),
            weeklyRemainingFraction: 1.0,
            weeklyRemainingPercent: "100.0%",
            weeklyResetTime: weeklyInfo.weeklyResetTime,
            weeklyResetCountdown: weeklyInfo.weeklyResetCountdown,
            weeklyResetLabel: weeklyInfo.weeklyResetLabel,
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
        // Context window usage corresponds to active prompt context footprint (input + cached read)
        const activeContext = sessionTokens.currentContextTokens ||
            (sessionTokens.inputTokens > 0 ? sessionTokens.inputTokens : sessionTokens.totalTokens);
        const usedTokens = activeContext;
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
//# sourceMappingURL=quota-service.js.map