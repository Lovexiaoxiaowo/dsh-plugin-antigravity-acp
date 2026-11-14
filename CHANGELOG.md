# Changelog

All notable changes to `dsh-plugin-antigravity-acp` will be documented in this file.

## [1.2.0] - 2026-11-14

### Added
- **DSH Native Subagent Provider (`ctx.subagents`)**:
  - Registered `antigravity` and `antigravity-acp` native subagent providers adhering strictly to DSH `SubagentProvider` and `SubagentRun` contracts.
  - Full parent context inheritance (workspace `cwd`) and external cancellation support (`request.signal`).
  - Seamlessly dispatched by DSH Coordinator, `/swarm`, and `/teamwork`.
- **Interactive Security Approval (`ctx.approval`)**:
  - Connected ACP `session/request_permission` to DSH native interactive approval popups (`ctx.approval.ask`).
  - Supports `allowed-once`, `allowed-always`, and `rejected` user decisions.
- **Structured Subagent Projection (`extractSubagentPayload`)**:
  - Extracted structured hierarchical subtask trees from ACP `tool_call`, `rawInput`, and swarm payloads into DSH session traces.
- **Compaction Service Coordination (`ctx.compaction`)**:
  - Integrated dynamic context pruning and compaction coordination with DSH engine.

### Fixed
- Hardened zip extraction and cross-platform path safety in bootstrapper (`execFileSync` + `-LiteralPath`).
- Restored backward compatibility for Node.js < 20.11 without crashing on `import.meta.dirname`.
- Fixed quota display rounding edge cases in `quota-service.ts`.

---

## [1.1.0] - 2026-10-31

### Added
- **Full Model Matrix Unlock**: Supported 9 core models across Gemini 3.8/2.5 series and Google-hosted Claude/GPT models.
- **Token Accounting & Accurate Cache Calculation**: Calibrated 5-hour sliding rate window and 7-day quota accounting.
- **Production Pipeline Resilience**: Added stream backpressure high/low watermark guards and timeout circuit breakers.

---

## [1.0.14] - 2026-10-31

### Fixed
- Fixed token multiplier overcounting and restored authentic 85%~95%+ cache hit rate.
- Automated assistant console output de-bloating and pruning.
- Real-time weekly quota API retrieval with constrained wood-barrel quota calculation.

---

## [1.0.13] - 2026-10-31

### Added
- Light & dark theme parity using official DSH token design system.
- Multimodal image input support via DSH `attachments` service and ACP image blocks.

---

## [1.0.0 ~ 1.0.12] - 2026-10-30

- Initial public releases featuring Google OAuth personal flow, ACP client transport, 5-hour rolling window dock pill, automatic binary downloader, and cross-process auto-recovery.
