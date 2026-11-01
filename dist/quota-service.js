import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getFreshAccessToken } from "./auth.js";
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
export function formatFractionPercent(fraction) {
    if (fraction >= 1)
        return "100.0%";
    if (fraction <= 0)
        return "0.0%";
    const p = fraction * 100;
    // If slightly consumed, do not round up to 100.0% to avoid illusion of non-responsive quota
    if (p > 99.0 && p < 100.0) {
        const f = Math.min(99.9, Number(p.toFixed(1))).toFixed(1);
        return `${f}%`;
    }
    return `${p.toFixed(1)}%`;
}
export function formatIntegerPercent(fraction) {
    if (fraction >= 1)
        return 100;
    if (fraction <= 0)
        return 0;
    const p = fraction * 100;
    if (p > 99.0 && p < 100.0)
        return 99;
    return Math.round(p);
}
export function formatCompactCountdown(resetTimeStr) {
    if (!resetTimeStr)
        return "计算中";
    const target = new Date(resetTimeStr).getTime();
    const diff = target - Date.now();
    if (diff <= 0)
        return "已重置";
    const totalMins = Math.floor(diff / (1000 * 60));
    const days = Math.floor(totalMins / (60 * 24));
    const hours = Math.floor((totalMins % (60 * 24)) / 60);
    const mins = totalMins % 60;
    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    if (hours > 0) {
        return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
}
/**
 * Reads local Antigravity-Manager account configuration & ground truth quota data
 * from ~/.antigravity_tools/accounts/*.json if present on host.
 */
export function getAntigravityToolsAccount() {
    try {
        const toolsDir = path.join(os.homedir(), ".antigravity_tools");
        const accountsJsonPath = path.join(toolsDir, "accounts.json");
        if (!fs.existsSync(accountsJsonPath))
            return null;
        const meta = JSON.parse(fs.readFileSync(accountsJsonPath, "utf-8"));
        const accountId = meta.current_account_id;
        if (!accountId)
            return null;
        const accountFilePath = path.join(toolsDir, "accounts", `${accountId}.json`);
        if (!fs.existsSync(accountFilePath))
            return null;
        return JSON.parse(fs.readFileSync(accountFilePath, "utf-8"));
    }
    catch {
        return null;
    }
}
export class AntigravityQuotaService {
    sessionManager;
    customEndpoints;
    cachedModelsData = null;
    cachedTierData = null;
    cachedSummaryData = null;
    lastFetchTime = 0;
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
    isCircuitOpen = false;
    pendingFetchPromise = null;
    CACHE_TTL_MS = 15_000; // 15s cache
    constructor(sessionManager, customEndpoints) {
        this.sessionManager = sessionManager;
        this.customEndpoints = customEndpoints;
    }
    recordFailure(durationMs = 30_000) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 3 || durationMs >= 60_000) {
            this.circuitOpenUntil = Math.max(this.circuitOpenUntil, Date.now() + durationMs);
            this.isCircuitOpen = true;
            console.warn(`[antigravity-acp] quota endpoint circuit breaker open for ${Math.round(durationMs / 1000)}s`);
        }
    }
    async postWithFallback(endpoints, token, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            for (const ep of endpoints) {
                if (controller.signal.aborted)
                    break;
                try {
                    const res = await fetch(ep, {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${token}`,
                            "content-type": "application/json",
                            "user-agent": "antigravity",
                        },
                        body: JSON.stringify(body),
                        signal: controller.signal,
                    });
                    if (res.ok) {
                        return await res.json();
                    }
                    if (res.status === 401) {
                        console.warn("[antigravity-acp] unauthorized token expired (HTTP 401)");
                    }
                    else if (res.status === 429) {
                        console.warn("[antigravity-acp] quota rate limit encountered (HTTP 429)");
                        this.recordFailure(60_000);
                        await res.body?.cancel().catch(() => { });
                        return null;
                    }
                    await res.body?.cancel().catch(() => { });
                }
                catch (err) {
                    if (controller.signal.aborted)
                        break;
                }
            }
        }
        finally {
            clearTimeout(timer);
        }
        return null;
    }
    fetchUpstreamData() {
        if (this.pendingFetchPromise) {
            return this.pendingFetchPromise;
        }
        this.pendingFetchPromise = this.doFetchUpstreamData().finally(() => {
            this.pendingFetchPromise = null;
        });
        return this.pendingFetchPromise;
    }
    async doFetchUpstreamData() {
        const now = Date.now();
        if (this.cachedModelsData && now - this.lastFetchTime < this.CACHE_TTL_MS) {
            return;
        }
        if (now < this.circuitOpenUntil) {
            this.isCircuitOpen = true;
            return;
        }
        else {
            this.isCircuitOpen = false;
        }
        const token = (await getFreshAccessToken()) || (this.customEndpoints ? "mock-token" : null);
        if (!token)
            return;
        try {
            const endpoints = Array.isArray(this.customEndpoints)
                ? { models: this.customEndpoints, tier: this.customEndpoints, summary: this.customEndpoints }
                : this.customEndpoints;
            const [modelsData, tierData, summaryData] = await Promise.all([
                this.postWithFallback(endpoints?.models || FETCH_MODELS_ENDPOINTS, token, {}),
                this.postWithFallback(endpoints?.tier || LOAD_TIER_ENDPOINTS, token, {
                    metadata: {
                        ideType: "ANTIGRAVITY",
                        pluginVersion: "1.0.0",
                    },
                }),
                this.postWithFallback(endpoints?.summary || QUOTA_SUMMARY_ENDPOINTS, token, {}),
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
            }
            else {
                this.recordFailure(30_000);
            }
        }
        catch (err) {
            this.recordFailure(30_000);
            console.warn("[antigravity-acp] quota fetch error:", err);
        }
    }
    formatCountdown(resetTimeStr) {
        if (!resetTimeStr)
            return undefined;
        const target = new Date(resetTimeStr).getTime();
        const diff = target - Date.now();
        if (diff <= 0)
            return "已平滑恢复";
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);
        const pad = (n) => n.toString().padStart(2, "0");
        return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    }
    formatWeeklyCountdown(resetTimeStr) {
        if (!resetTimeStr)
            return "计算中";
        const target = new Date(resetTimeStr).getTime();
        const diff = target - Date.now();
        if (diff <= 0)
            return "已重置";
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (days > 0) {
            return `${days}天${hours}小时`;
        }
        return `${hours}小时${mins}分`;
    }
    formatResetDate(resetTimeStr) {
        if (!resetTimeStr)
            return "自然周动态重置";
        try {
            const d = new Date(resetTimeStr);
            const month = d.getMonth() + 1;
            const date = d.getDate();
            const hours = d.getHours().toString().padStart(2, "0");
            const mins = d.getMinutes().toString().padStart(2, "0");
            return `${month}月${date}日 ${hours}:${mins}`;
        }
        catch {
            return "自然周动态重置";
        }
    }
    async getSnapshot(sessionId, modelId = "gemini-3.8-flash") {
        await this.fetchUpstreamData();
        // Ground truth sync with local Antigravity-Manager accounts database if available
        const mgrAccount = getAntigravityToolsAccount();
        const mgrGroups = mgrAccount?.quota?.quota_groups || [];
        const mgrGeminiGroup = mgrGroups.find((g) => /gemini/i.test(g.display_name || g.displayName || ""));
        const mgrGemini5h = mgrGeminiGroup?.buckets?.find((b) => /5h|hour/i.test(`${b.bucket_id || b.bucketId || ""} ${b.window || ""}`));
        const mgrGeminiWeekly = mgrGeminiGroup?.buckets?.find((b) => /week|7d/i.test(`${b.bucket_id || b.bucketId || ""} ${b.window || ""}`));
        const mgr3pGroup = mgrGroups.find((g) => /claude|gpt|3p/i.test(g.display_name || g.displayName || ""));
        const mgr3p5h = mgr3pGroup?.buckets?.find((b) => /5h|hour/i.test(`${b.bucket_id || b.bucketId || ""} ${b.window || ""}`));
        const mgr3pWeekly = mgr3pGroup?.buckets?.find((b) => /week|7d/i.test(`${b.bucket_id || b.bucketId || ""} ${b.window || ""}`));
        const models = this.cachedModelsData || {};
        const normalizedTarget = modelId.toLowerCase().replace(/[^a-z0-9]/g, "");
        let modelEntry = models[modelId] ||
            models[`${modelId}-tiered`] ||
            models[`${modelId}-thinking`];
        if (!modelEntry) {
            for (const [k, v] of Object.entries(models)) {
                if (k.startsWith("tab_") || k.startsWith("chat_"))
                    continue;
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
        // 1. Resolve Tier identity
        const tierName = this.cachedTierData?.paidTier?.name ||
            this.cachedTierData?.currentTier?.name ||
            (mgrAccount?.quota?.subscription_tier ? `Google AI ${mgrAccount.quota.subscription_tier}` : "Google AI Pro");
        // 2. Parse Grouped Quotas from retrieveUserQuotaSummary
        const summaryGroups = this.cachedSummaryData?.groups || [];
        // Find Claude & GPT (3P) group
        const thirdPartyGroup = summaryGroups.find((g) => {
            const name = (g.displayName || "").toLowerCase();
            return name.includes("claude") || name.includes("gpt") || name.includes("3p");
        });
        const tp5hBucket = thirdPartyGroup?.buckets?.find((b) => /5h|hour/i.test(`${b.window || ""} ${b.bucketId || ""}`));
        const tpWeeklyBucket = thirdPartyGroup?.buckets?.find((b) => /week|7d/i.test(`${b.window || ""} ${b.bucketId || ""}`));
        // Find Gemini Group if explicitly present in summary
        const geminiGroupFromSummary = summaryGroups.find((g) => {
            const name = (g.displayName || "").toLowerCase();
            return name.includes("gemini") || (!name.includes("claude") && !name.includes("gpt") && !name.includes("3p"));
        });
        const summaryGemini5hBucket = geminiGroupFromSummary?.buckets?.find((b) => /5h|hour/i.test(`${b.window || ""} ${b.bucketId || ""}`));
        const summaryGeminiWeeklyBucket = geminiGroupFromSummary?.buckets?.find((b) => /week|7d/i.test(`${b.window || ""} ${b.bucketId || ""}`));
        // Gemini 5h quota from model, summary, or Antigravity-Manager ground truth
        const geminiModelQuotaInfo = modelEntry?.quotaInfo;
        const gemini5hFraction = typeof geminiModelQuotaInfo?.remainingFraction === "number"
            ? geminiModelQuotaInfo.remainingFraction
            : typeof summaryGemini5hBucket?.remainingFraction === "number"
                ? summaryGemini5hBucket.remainingFraction
                : typeof mgrGemini5h?.remaining_fraction === "number"
                    ? mgrGemini5h.remaining_fraction
                    : typeof mgrGemini5h?.remainingFraction === "number"
                        ? mgrGemini5h.remainingFraction
                        : 1.0;
        const gemini5hReset = geminiModelQuotaInfo?.resetTime ||
            summaryGemini5hBucket?.resetTime ||
            mgrGemini5h?.reset_time ||
            mgrGemini5h?.resetTime;
        // Gemini Weekly quota: NEVER fall back to Claude's weekly bucket!
        const geminiWeeklyFraction = typeof summaryGeminiWeeklyBucket?.remainingFraction === "number"
            ? summaryGeminiWeeklyBucket.remainingFraction
            : typeof mgrGeminiWeekly?.remaining_fraction === "number"
                ? mgrGeminiWeekly.remaining_fraction
                : typeof mgrGeminiWeekly?.remainingFraction === "number"
                    ? mgrGeminiWeekly.remainingFraction
                    : 1.0;
        const geminiWeeklyReset = summaryGeminiWeeklyBucket?.resetTime ||
            mgrGeminiWeekly?.reset_time ||
            mgrGeminiWeekly?.resetTime;
        const geminiWeeklyDesc = summaryGeminiWeeklyBucket?.description ||
            mgrGeminiWeekly?.description ||
            "7天自然周算力上限";
        // Claude & GPT 5h & Weekly
        const tp5hFraction = typeof tp5hBucket?.remainingFraction === "number"
            ? tp5hBucket.remainingFraction
            : typeof mgr3p5h?.remaining_fraction === "number"
                ? mgr3p5h.remaining_fraction
                : typeof mgr3p5h?.remainingFraction === "number"
                    ? mgr3p5h.remainingFraction
                    : 1.0;
        const tp5hReset = tp5hBucket?.resetTime ||
            mgr3p5h?.reset_time ||
            mgr3p5h?.resetTime;
        const tpWeeklyFraction = typeof tpWeeklyBucket?.remainingFraction === "number"
            ? tpWeeklyBucket.remainingFraction
            : typeof mgr3pWeekly?.remaining_fraction === "number"
                ? mgr3pWeekly.remaining_fraction
                : typeof mgr3pWeekly?.remainingFraction === "number"
                    ? mgr3pWeekly.remainingFraction
                    : 1.0;
        const tpWeeklyReset = tpWeeklyBucket?.resetTime ||
            mgr3pWeekly?.reset_time ||
            mgr3pWeekly?.resetTime;
        const tpWeeklyDesc = tpWeeklyBucket?.description ||
            mgr3pWeekly?.description ||
            "Claude & GPT 托管模型周配额";
        // 3. Constrained Quota (Wood Barrel Short-board Logic) for Active Model
        const isWeeklyExhausted = geminiWeeklyFraction <= 0.001;
        const is5hCooling = gemini5hFraction <= 0.001 && geminiWeeklyFraction > 0.001;
        const isWeeklyConstrained = isWeeklyExhausted || geminiWeeklyFraction < gemini5hFraction;
        const effectiveFraction = isWeeklyExhausted ? 0 : Math.min(gemini5hFraction, geminiWeeklyFraction);
        const effectivePercent = formatFractionPercent(effectiveFraction);
        const maxContextTokens = Number(modelEntry?.maxTokens || DEFAULT_MAX_TOKENS);
        // 4. Construct 4-quadrant Quota Cards aligned 100% with Antigravity-Manager
        const cards = [
            {
                id: "gemini-5h",
                title: "Gemini 3.8 / 3.5 5H",
                group: "gemini",
                type: "5h",
                remainingFraction: gemini5hFraction,
                percentage: formatIntegerPercent(gemini5hFraction),
                formattedPercent: `${formatIntegerPercent(gemini5hFraction)}%`,
                resetTime: gemini5hReset,
                resetCountdown: formatCompactCountdown(gemini5hReset),
                color: gemini5hFraction < 0.2 ? "red" : gemini5hFraction < 0.5 ? "orange" : "green",
            },
            {
                id: "claude-5h",
                title: "Claude 4.6 / GPT 5H",
                group: "claude",
                type: "5h",
                remainingFraction: tp5hFraction,
                percentage: formatIntegerPercent(tp5hFraction),
                formattedPercent: `${formatIntegerPercent(tp5hFraction)}%`,
                resetTime: tp5hReset,
                resetCountdown: formatCompactCountdown(tp5hReset),
                color: tp5hFraction < 0.2 ? "red" : tp5hFraction < 0.5 ? "orange" : "green",
            },
            {
                id: "gemini-weekly",
                title: "Gemini 周配额",
                group: "gemini",
                type: "weekly",
                remainingFraction: geminiWeeklyFraction,
                percentage: formatIntegerPercent(geminiWeeklyFraction),
                formattedPercent: `${formatIntegerPercent(geminiWeeklyFraction)}%`,
                resetTime: geminiWeeklyReset,
                resetCountdown: formatCompactCountdown(geminiWeeklyReset),
                color: geminiWeeklyFraction < 0.2 ? "red" : geminiWeeklyFraction < 0.5 ? "orange" : "green",
                description: geminiWeeklyDesc,
            },
            {
                id: "claude-weekly",
                title: "Claude 周配额",
                group: "claude",
                type: "weekly",
                remainingFraction: tpWeeklyFraction,
                percentage: formatIntegerPercent(tpWeeklyFraction),
                formattedPercent: `${formatIntegerPercent(tpWeeklyFraction)}%`,
                resetTime: tpWeeklyReset,
                resetCountdown: formatCompactCountdown(tpWeeklyReset),
                color: tpWeeklyFraction < 0.2 ? "red" : tpWeeklyFraction < 0.5 ? "orange" : "green",
                description: tpWeeklyDesc,
            },
        ];
        // Build Model Groups array
        const groups = [
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
                    remainingPercent: formatFractionPercent(gemini5hFraction),
                    resetTime: gemini5hReset,
                    resetCountdown: formatCompactCountdown(gemini5hReset),
                },
                weekly: {
                    remainingFraction: geminiWeeklyFraction,
                    remainingPercent: formatFractionPercent(geminiWeeklyFraction),
                    resetTime: geminiWeeklyReset,
                    resetCountdown: formatCompactCountdown(geminiWeeklyReset),
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
                    remainingPercent: formatFractionPercent(tp5hFraction),
                    resetTime: tp5hReset,
                    resetCountdown: formatCompactCountdown(tp5hReset),
                },
                weekly: {
                    remainingFraction: tpWeeklyFraction,
                    remainingPercent: formatFractionPercent(tpWeeklyFraction),
                    resetTime: tpWeeklyReset,
                    resetCountdown: formatCompactCountdown(tpWeeklyReset),
                    description: tpWeeklyDesc,
                },
                effectiveFraction: tpWeeklyFraction <= 0.001 ? 0 : Math.min(tp5hFraction, tpWeeklyFraction),
                effectivePercent: formatFractionPercent(Math.min(tp5hFraction, tpWeeklyFraction)),
                isWeeklyExhausted: tpWeeklyFraction <= 0.001,
                isWeeklyConstrained: tpWeeklyFraction < tp5hFraction,
                is5hCooling: tp5hFraction <= 0.001 && tpWeeklyFraction > 0.001,
            },
        ];
        const quotaSummary = {
            model: modelId,
            displayName: modelEntry?.displayName || "Gemini 3.8 Flash (Antigravity)",
            accountEmail: mgrAccount?.email || "ltxx1017@gmail.com",
            remainingFraction: gemini5hFraction,
            remainingPercent: formatFractionPercent(gemini5hFraction),
            resetTime: gemini5hReset,
            resetCountdown: formatCompactCountdown(gemini5hReset),
            weeklyRemainingFraction: geminiWeeklyFraction,
            weeklyRemainingPercent: formatFractionPercent(geminiWeeklyFraction),
            weeklyResetTime: geminiWeeklyReset,
            weeklyResetCountdown: formatCompactCountdown(geminiWeeklyReset),
            weeklyResetLabel: this.formatResetDate(geminiWeeklyReset),
            weeklyDescription: geminiWeeklyDesc,
            effectiveFraction,
            effectivePercent,
            isWeeklyExhausted,
            isWeeklyConstrained,
            is5hCooling,
            tier: tierName,
            maxTokens: maxContextTokens,
            cards,
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
        const activeContext = sessionTokens.currentContextTokens ||
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
//# sourceMappingURL=quota-service.js.map