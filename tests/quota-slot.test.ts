import { describe, it, expect } from "vitest";
import { formatFractionPercent, AntigravityQuotaService } from "../src/quota-service.js";
import { DshSessionManager } from "../src/session-manager.js";

describe("Slot 显示与实际值对照测试", () => {
  it("数值格式化 formatFractionPercent: 边缘值与防虚假饱满", () => {
    expect(formatFractionPercent(1.0)).toBe("100.0%");
    expect(formatFractionPercent(0.0)).toBe("0.0%");
    // 微量消耗不应该向上舍入到 100.0%
    expect(formatFractionPercent(0.9996)).toBe("99.9%");
    expect(formatFractionPercent(0.90995)).toBe("91.0%");
    expect(formatFractionPercent(0.499)).toBe("49.9%");
  });

  it("Slot 状态与显示文字映射逻辑", () => {
    function computeSlotDisplay(snapshot: any) {
      const quota = snapshot?.quota;
      const isReady = Boolean(snapshot && quota);
      const fraction = (quota && quota.remainingFraction != null) ? quota.remainingFraction : 1;
      const isExhausted = Boolean(quota && quota.isWeeklyExhausted);
      const isCooling = Boolean(quota && quota.is5hCooling);

      const quotaColor = !isReady
        ? '#94a3b8'
        : isExhausted
        ? '#ef4444'
        : isCooling
        ? '#f59e0b'
        : fraction < 0.2
        ? '#ef4444'
        : fraction < 0.5
        ? '#f59e0b'
        : '#10b981';

      const isQuotaWarn = isReady && (isExhausted || fraction < 0.2);

      const pillLabel = !isReady
        ? '额度同步中'
        : isExhausted
        ? '周额度见底(0%)'
        : isCooling
        ? '5H冷却中(0%)'
        : '5H ' + quota.remainingPercent;

      const weeklyLabel = !isReady
        ? '周同步中'
        : '周 ' + (quota.weeklyRemainingPercent || '100%');

      return {
        pillLabel,
        weeklyLabel,
        badgeText: `⚡ ${pillLabel} | ${weeklyLabel} ▾`,
        quotaColor,
        isQuotaWarn,
      };
    }

    // 1. 模拟未就绪
    expect(computeSlotDisplay(null).badgeText).toBe("⚡ 额度同步中 | 周同步中 ▾");

    // 2. 模拟 5H 91.0% + 周 99.9%
    const currentMock = {
      quota: {
        remainingFraction: 0.90995,
        remainingPercent: "91.0%",
        weeklyRemainingFraction: 0.9996,
        weeklyRemainingPercent: "99.9%",
        isWeeklyExhausted: false,
        is5hCooling: false,
      },
    };
    const res = computeSlotDisplay(currentMock);
    expect(res.badgeText).toBe("⚡ 5H 91.0% | 周 99.9% ▾");
    expect(res.quotaColor).toBe("#10b981");
    expect(res.isQuotaWarn).toBe(false);

    // 3. 模拟 5H 耗尽但周额度充足 (冷却中)
    const coolingMock = {
      quota: {
        remainingFraction: 0,
        remainingPercent: "0.0%",
        weeklyRemainingFraction: 0.8,
        weeklyRemainingPercent: "80.0%",
        isWeeklyExhausted: false,
        is5hCooling: true,
      },
    };
    const coolingRes = computeSlotDisplay(coolingMock);
    expect(coolingRes.pillLabel).toBe("5H冷却中(0%)");
    expect(coolingRes.quotaColor).toBe("#f59e0b");

    // 4. 模拟周额度耗尽 (熔断)
    const exhaustedMock = {
      quota: {
        remainingFraction: 0,
        remainingPercent: "0.0%",
        weeklyRemainingFraction: 0,
        weeklyRemainingPercent: "0.0%",
        isWeeklyExhausted: true,
        is5hCooling: false,
      },
    };
    const exhRes = computeSlotDisplay(exhaustedMock);
    expect(exhRes.pillLabel).toBe("周额度见底(0%)");
    expect(exhRes.quotaColor).toBe("#ef4444");
    expect(exhRes.isQuotaWarn).toBe(true);
  });

  it("真实 QuotaService 能够获取实时配额 Snapshot", async () => {
    const sessionMgr = new DshSessionManager();
    const service = new AntigravityQuotaService(sessionMgr);
    const snapshot = await service.getSnapshot(undefined, "gemini-3.8-flash");

    expect(snapshot).toBeDefined();
    expect(snapshot.quota).toBeDefined();
    expect(snapshot.quota.model).toBe("gemini-3.8-flash");
    expect(typeof snapshot.quota.remainingFraction).toBe("number");
    expect(snapshot.quota.remainingPercent).toMatch(/^\d+\.\d+%$/);
    expect(typeof snapshot.quota.weeklyRemainingFraction).toBe("number");
    expect(snapshot.quota.weeklyRemainingPercent).toMatch(/^\d+\.\d+%$/);
    expect(snapshot.quota.groups).toHaveLength(2);
  });
});
