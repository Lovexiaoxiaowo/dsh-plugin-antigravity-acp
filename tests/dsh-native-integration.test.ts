import { describe, it, expect, vi } from "vitest";
import { apply, DshAntigravityService } from "../src/index.js";

describe("DSH Native High-Tier Integration Suite", () => {
  it("injects approval and compaction services and delegates interactive permission asks", async () => {
    let approvalAskSpy = vi.fn().mockResolvedValue("allowed-once");
    const mockApprovalService = { ask: approvalAskSpy };
    const mockCompactionService = { compact: vi.fn() };

    const registeredProviders: Record<string, any> = {};
    const mockSubagentsService = {
      registerProvider: vi.fn((provider: any) => {
        registeredProviders[provider.name] = provider;
      }),
    };

    let providedService: DshAntigravityService | null = null;

    const mockCtx: any = {
      provide: vi.fn((name: string, svc: any) => {
        if (name === "antigravityAcp") {
          providedService = svc;
        }
      }),
      inject: vi.fn((deps: string[], callback: (scope: any) => void) => {
        const scope: any = {};
        if (deps.includes("approval")) scope.approval = mockApprovalService;
        if (deps.includes("compaction")) scope.compaction = mockCompactionService;
        if (deps.includes("subagents")) scope.subagents = mockSubagentsService;
        callback(scope);
      }),
      on: vi.fn(),
    };

    apply(mockCtx, { permissionMode: "ask" });

    expect(providedService).toBeTruthy();
    expect((providedService as any).approvalService).toBe(mockApprovalService);
    expect((providedService as any).compactionService).toBe(mockCompactionService);

    // Verify subagents provider registration
    expect(mockSubagentsService.registerProvider).toHaveBeenCalledTimes(2);
    expect(registeredProviders["antigravity"]).toBeTruthy();
    expect(registeredProviders["antigravity-acp"]).toBeTruthy();
    expect(registeredProviders["antigravity"].capabilities.agentOptions).toBe(false);
    expect(registeredProviders["antigravity"].inheritsParentContext).toBe(false);
  });

  it("subagents provider start() drives delegated task and returns DSH SubagentRun contract", async () => {
    let subagentsService: any = null;
    let providedService: DshAntigravityService | null = null;

    const mockCtx: any = {
      provide: vi.fn((_, svc) => {
        providedService = svc;
      }),
      inject: vi.fn((deps: string[], cb: any) => {
        if (deps.includes("subagents")) {
          subagentsService = {
            registerProvider: vi.fn((provider) => {
              if (provider.name === "antigravity") {
                subagentsService.provider = provider;
              }
            }),
          };
          cb({ subagents: subagentsService });
        }
      }),
      on: vi.fn(),
    };

    apply(mockCtx);

    expect(providedService).toBeTruthy();
    expect(subagentsService.provider).toBeTruthy();

    // Mock executeDelegatedTask
    const executeSpy = vi.spyOn(providedService as any, "executeDelegatedTask").mockResolvedValue({
      success: true,
      output: "Subagent completed audit successfully",
      model: "gemini-3.8-flash",
      durationMs: 120,
    });

    const provider = subagentsService.provider;
    const run = await provider.start({
      prompt: [{ type: "text", text: "Analyze memory leak" }],
      parent: { session: { header: { cwd: "D:/test-project" } } },
      agentOptions: { model: "gemini-2.5-pro" },
    });

    expect(run.id).toBeTruthy();
    expect(typeof run.dispose).toBe("function");

    const result = await run.result;
    expect(result.stopReason).toBe("completed");
    expect(result.output).toEqual([{ type: "text", text: "Subagent completed audit successfully" }]);
    expect(executeSpy).toHaveBeenCalledWith("Analyze memory leak", expect.objectContaining({
      cwd: "D:/test-project",
      model: "gemini-2.5-pro",
    }));
  });

  it("onRequestPermission prompts user via DSH approval service when available", async () => {
    const service = new DshAntigravityService({ permissionMode: "ask" });
    const approvalAskMock = vi.fn().mockResolvedValue("allowed-once");
    service.setApprovalService({ ask: approvalAskMock });

    // Mock client creation and capture onRequestPermission
    let onRequestPermissionHandler: any = null;
    vi.spyOn(service as any, "isLoggedIn").mockReturnValue(true);
    (service as any).projectRoot = "D:/dummy";

    // Call initialize simulation
    const fakeClient = {
      start: vi.fn().mockResolvedValue(undefined),
    };

    // Inject fake AntigravityAcpClient constructor spy
    const originalInit = service.initialize;
    vi.spyOn(service, "initialize").mockImplementation(async () => {
      onRequestPermissionHandler = async (req: any) => {
        if ((service as any).approvalService && (service as any).config.permissionMode !== "yolo") {
          const outcome = await (service as any).approvalService.ask({
            description: req.toolCall?.title || req.description,
            toolCall: req.toolCall,
            options: req.options,
          });
          if (outcome === "allowed-once" || outcome === "allowed-always") {
            const allowOpt = req.options?.find((opt: any) => opt.optionId.includes("allow")) || req.options?.[0];
            return { outcome: { outcome: "selected", optionId: allowOpt.optionId } };
          }
        }
        return { outcome: { outcome: "cancelled" } };
      };
    });

    await service.initialize();
    expect(onRequestPermissionHandler).toBeTruthy();

    const response = await onRequestPermissionHandler({
      toolCall: { title: "Bash Command: rm -rf dist" },
      options: [{ optionId: "allow_once", label: "Allow" }, { optionId: "reject", label: "Reject" }],
    });

    expect(approvalAskMock).toHaveBeenCalledWith(expect.objectContaining({
      description: "Bash Command: rm -rf dist",
    }));
    expect(response.outcome.outcome).toBe("selected");
    expect(response.outcome.optionId).toBe("allow_once");
  });
});
