import { describe, it, expect, vi, beforeEach } from "vitest";
import { DshAntigravityService, KNOWN_ANTIGRAVITY_MODELS } from "../src/index.js";
import { AntigravityAcpClient } from "../src/acp-client.js";

describe("Long-term Model Introspection and Filtering Pipeline", () => {
  let service: DshAntigravityService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new DshAntigravityService();
  });

  describe("ACP Client Introspection & ConfigOptions Parsing", () => {
    it("should extract flat model select options from ACP configOptions", () => {
      const client = new AntigravityAcpClient("dummy-path");
      const configOptions = [
        {
          id: "model",
          name: "Model",
          type: "select",
          options: [
            { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
            { value: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
            { value: "custom-future-model", name: "Future Model 4.0" },
          ],
        },
      ];

      const extracted = client.extractAndCacheConfigOptions(configOptions);
      expect(extracted).toHaveLength(3);
      expect(extracted[0]).toEqual({
        id: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        description: undefined,
      });
      expect(extracted[2].id).toBe("custom-future-model");
      expect(client.getConfigModels()).toEqual(extracted);
    });

    it("should extract grouped model select options from nested groups", () => {
      const client = new AntigravityAcpClient("dummy-path");
      const configOptions = [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          options: [
            {
              group: "Gemini",
              options: [
                { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
                { value: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
              ],
            },
            {
              group: "Claude",
              options: [
                { value: "claude-opus-4-6-thinking", name: "Claude Opus 4.6" },
              ],
            },
          ],
        },
      ];

      const extracted = client.extractAndCacheConfigOptions(configOptions);
      expect(extracted).toHaveLength(3);
      expect(extracted.map((m) => m.id)).toEqual([
        "gemini-3.8-flash",
        "gemini-2.5-flash",
        "claude-opus-4-6-thinking",
      ]);
    });
  });

  describe("hasUpstreamEntitlement", () => {
    it("should allow any model if upstreamModels is empty or not yet loaded", () => {
      expect(service.hasUpstreamEntitlement("gemini-3.8-flash", {})).toBe(true);
    });

    it("should match direct key and tiered suffixes", () => {
      const upstream = {
        "gemini-3.8-flash": { maxTokens: 1048576 },
        "gemini-2.5-pro-tiered": { maxTokens: 1048576 },
      };

      expect(service.hasUpstreamEntitlement("gemini-3.8-flash", upstream)).toBe(true);
      expect(service.hasUpstreamEntitlement("gemini-2.5-pro", upstream)).toBe(true);
      expect(service.hasUpstreamEntitlement("claude-opus-4-6-thinking", upstream)).toBe(false);
    });

    it("should normalize and match case-insensitively and ignore hyphens", () => {
      const upstream = {
        "gemini38flash": { maxTokens: 1048576 },
      };
      expect(service.hasUpstreamEntitlement("gemini-3.8-flash", upstream)).toBe(true);
    });
  });

  describe("getEffectiveModels Pipeline", () => {
    it("should fallback to KNOWN_ANTIGRAVITY_MODELS when ACP client is not connected", async () => {
      const models = await service.getEffectiveModels("google-antigravity", { includeCoolingTags: false });
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.id === "gemini-3.8-flash")).toBe(true);
      expect(models.every((m) => !m.id.startsWith("tab_") && !m.id.startsWith("chat_"))).toBe(true);
    });

    it("should filter out 3P models on free tier", async () => {
      vi.spyOn(service.quotaService, "isFreeTier").mockReturnValue(true);
      vi.spyOn(service, "isLoggedIn").mockReturnValue(false);

      const models = await service.getEffectiveModels("google-antigravity", { includeCoolingTags: false });
      const ids = models.map((m) => m.id);

      expect(ids).toContain("gemini-3.8-flash");
      expect(ids).not.toContain("claude-opus-4-6-thinking");
      expect(ids).not.toContain("claude-sonnet-4-6");
      expect(ids).not.toContain("gpt-oss-120b-medium");
    });

    it("should retain 3P models on paid tier", async () => {
      vi.spyOn(service.quotaService, "isFreeTier").mockReturnValue(false);
      vi.spyOn(service, "isLoggedIn").mockReturnValue(false);

      const models = await service.getEffectiveModels("google-antigravity", { includeCoolingTags: false });
      const ids = models.map((m) => m.id);

      expect(ids).toContain("gemini-3.8-flash");
      expect(ids).toContain("claude-opus-4-6-thinking");
      expect(ids).toContain("gpt-oss-120b-medium");
    });

    it("should exclude models not entitled in upstream models data", async () => {
      vi.spyOn(service.quotaService, "isFreeTier").mockReturnValue(false);
      vi.spyOn(service.quotaService, "getCachedModelsData").mockReturnValue({
        "gemini-3.8-flash": { maxTokens: 1048576 },
        "gemini-2.5-flash": { maxTokens: 1048576 },
        // Notice gemini-2.5-pro and claude are missing from upstream
      });
      vi.spyOn(service, "isLoggedIn").mockReturnValue(false);

      const models = await service.getEffectiveModels("google-antigravity", { includeCoolingTags: false });
      const ids = models.map((m) => m.id);

      expect(ids).toContain("gemini-3.8-flash");
      expect(ids).toContain("gemini-2.5-flash");
      expect(ids).not.toContain("gemini-2.5-pro");
      expect(ids).not.toContain("claude-opus-4-6-thinking");
    });

    it("should dynamically incorporate new models discovered via ACP probe/session", async () => {
      const mockClient = {
        getConfigModels: vi.fn().mockReturnValue([
          { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
          { id: "gemini-4.0-ultra-agent", name: "Gemini 4.0 Ultra Agent" },
        ]),
        probeSupportedModels: vi.fn(),
      };
      (service as any).client = mockClient;
      vi.spyOn(service, "isLoggedIn").mockReturnValue(false);

      const models = await service.getEffectiveModels("google-antigravity", { includeCoolingTags: false });
      const ids = models.map((m) => m.id);

      expect(ids).toContain("gemini-3.8-flash");
      expect(ids).toContain("gemini-4.0-ultra-agent");
    });

    it("should decorate displayName with cooling and exhaustion labels", async () => {
      vi.spyOn(service.quotaService, "getModelQuotaState").mockImplementation((modelId) => {
        if (modelId === "gemini-2.5-pro") {
          return {
            isWeeklyExhausted: false,
            isWeeklyConstrained: false,
            is5hCooling: true,
            resetCountdown: "01:23:45",
            effectiveFraction: 0,
          };
        }
        if (modelId === "claude-opus-4-6-thinking") {
          return {
            isWeeklyExhausted: true,
            isWeeklyConstrained: true,
            is5hCooling: false,
            effectiveFraction: 0,
          };
        }
        return null;
      });
      vi.spyOn(service.quotaService, "isFreeTier").mockReturnValue(false);
      vi.spyOn(service, "isLoggedIn").mockReturnValue(false);

      const models = await service.getEffectiveModels("google-antigravity", { includeCoolingTags: true });
      const pro = models.find((m) => m.id === "gemini-2.5-pro");
      const claude = models.find((m) => m.id === "claude-opus-4-6-thinking");

      expect(pro?.name).toContain("[5h冷却中 01:23:45]");
      expect(claude?.name).toContain("[周额度已耗尽]");
    });
  });

  describe("Resilient createSession Fallback", () => {
    it("should fall back to default model if requested model fails", async () => {
      const createSessionMock = vi.fn()
        .mockRejectedValueOnce(new Error("Model unsupported: obsolete-model"))
        .mockResolvedValueOnce({ sessionId: "fallback-session-123" });

      (service as any).client = {
        createSession: createSessionMock,
      };

      const res = await service.createSession("D:/test", { model: "obsolete-model" });
      expect(res.sessionId).toBe("fallback-session-123");
      expect(createSessionMock).toHaveBeenCalledTimes(2);
      expect(createSessionMock).toHaveBeenNthCalledWith(2, "D:/test", expect.objectContaining({
        model: "gemini-3.8-flash",
      }));
    });
  });
});
