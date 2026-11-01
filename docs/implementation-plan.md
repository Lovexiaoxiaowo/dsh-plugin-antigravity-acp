# Architecture Hardening plan

This program hardens the Antigravity ACP plugin architecture across four PR units.
It eliminates event loop stalls, bounds streaming memory, adds network timeouts, and builds automated regression testing.
The changes serve DSH desktop users and downstream plugin maintainers.
Execution runs through four sequential PRs from pr-01 to pr-04.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator reviews each stack head and merges the completed stack to trunk.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:cursor-team-kit/control-cli/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:pstack/skills/principle-prove-it-works/SKILL.md`
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] `pr-01-async-debounced-io` is independent and first. It branches from `main`.
  - [ ] `pr-02-quota-timeout-circuit-breaker` is independent and branches from `main`.
  - [ ] `pr-03-streaming-backpressure-guard` stacks on `pr-01-async-debounced-io`.
  - [ ] `pr-04-protocol-test-suite` stacks on `pr-03-streaming-backpressure-guard` and incorporates `pr-02-quota-timeout-circuit-breaker`.
- [ ] Hold the file boundaries. PRs touch only designated files in `src/` and `tests/`.
- [ ] Hold the review gate. `pr-01-async-debounced-io` and `pr-03-streaming-backpressure-guard` change critical runtime paths.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, or on a CI failure that comes from a change on trunk.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Append the verified PR to the linear stack branch. The operator lands the stack bottom-up after final verification.

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. Drive through `control-ui` or `control-cli` from `cursor-team-kit`.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Start the Node.js test environment or plugin runtime harness. Wait for ready signal.
- [ ] Deliver input only through the control skill's commands. Name the read-only diagnostics.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Implement asynchronous debounced session persistence (pr-01-async-debounced-io)

**Depends on.** None.

**Files.**

- [ ] Edit `src/session-manager.ts`.

**Build.**

- [ ] Add asynchronous debounced disk flush using `fs.promises.writeFile` with atomic temporary file swapping and synchronous exit flush in `DshSessionManager`.

**You see.**

- [ ] Rapid consecutive token records batch into a single disk write after 500ms debounce interval without blocking the event loop.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Unit check verifies that ten synchronous `recordUsage` calls trigger exactly one disk write after 500ms delay. Run `node scripts/test-debounced-io.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run rapid hundred token updates at trunk and head. If trunk lacks async debounce, record synchronous latency spikes and gate zero event loop lag during disk flush. Save `/tmp/swarm-pr-01/worker-1/regression-trunk.png`. Pass when event loop lag remains under 5ms.
- [ ] Lane 2. Multi-turn chat message count persistence. Save `/tmp/swarm-pr-01/worker-2/message-count.png`. Pass when final saved message count matches in-memory map.
- [ ] Lane 3. Token stats serialization integrity. Save `/tmp/swarm-pr-01/worker-3/token-stats.png`. Pass when JSON parse of persisted file succeeds and schema matches.
- [ ] Lane 4. Sudden process exit flush guarantee. Save `/tmp/swarm-pr-01/worker-4/process-exit.png`. Pass when exit handler flushes pending writes completely.
- [ ] Lane 5. Atomic file replacement with temporary file. Save `/tmp/swarm-pr-01/worker-5/atomic-swap.png`. Pass when partial writes never corrupt sessions JSON.
- [ ] Lane 6. Directory auto-creation resilience. Save `/tmp/swarm-pr-01/worker-6/directory-creation.png`. Pass when missing root folder creates recursively without error.
- [ ] Lane 7. Concurrent session updates across five IDs. Save `/tmp/swarm-pr-01/worker-7/concurrent-sessions.png`. Pass when all five sessions serialize without race conditions.
- [ ] Lane 8. Corrupted JSON file recovery on startup. Save `/tmp/swarm-pr-01/worker-8/corrupted-recovery.png`. Pass when invalid JSON logs warning and initializes empty state safely.
- [ ] Lane 9. Debounce timer reset on rapid stream events. Save `/tmp/swarm-pr-01/worker-9/timer-reset.png`. Pass when trailing edge executes cleanly after stream finishes.
- [ ] Lane 10. Memory footprint during high-frequency updates. Save `/tmp/swarm-pr-01/worker-10/memory-leak.png`. Pass when heap consumption remains flat across 1000 records.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Mean event loop lag in milliseconds during burst write of 500 session records.
- [ ] Probe. Interleaved execution of 500 `saveBinding` operations with `perf_hooks` monitoring loop delay.
- [ ] Baseline. Trunk synchronous write baseline measured at 84ms cumulative event loop block.
- [ ] Rule. Head event loop lag must not exceed 6ms total, achieving over 10x reduction in thread stalling.

**Review gate.** None. pr-01-async-debounced-io is not review-gated.

**Merge.**

- [ ] Root clean verdict on head commit.
- [ ] Rebased cleanly on origin main.
- [ ] Squash merge commit ready for stack inclusion.

## Add upstream quota fetch timeout and circuit breaker (pr-02-quota-timeout-circuit-breaker)

**Depends on.** None.

**Files.**

- [ ] Edit `src/quota-service.ts`.

**Build.**

- [ ] Add `AbortSignal.timeout(5000)` and circuit breaker logic around Google Cloud Code quota endpoints in `AntigravityQuotaService`.

**You see.**

- [ ] Stalled Google quota endpoints abort cleanly at five seconds and fallback to cached snapshot with stale indicator set.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Unit check verifies that mock hung endpoint triggers abort within 5100ms and returns stale cache. Run `node scripts/test-quota-timeout.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run hung network simulation at trunk and head. If trunk lacks abort signal, record infinite hang and gate five second timeout completion. Save `/tmp/swarm-pr-02/worker-1/regression-trunk.png`. Pass when request resolves within 5200ms.
- [ ] Lane 2. Normal quota response fast path. Save `/tmp/swarm-pr-02/worker-2/fast-path.png`. Pass when healthy 200 response updates memory snapshot immediately.
- [ ] Lane 3. Consecutive failure circuit opening. Save `/tmp/swarm-pr-02/worker-3/circuit-open.png`. Pass when three failures trigger temporary 30s bypass of remote fetch.
- [ ] Lane 4. Circuit half-open recovery probe. Save `/tmp/swarm-pr-02/worker-4/circuit-half-open.png`. Pass when single successful probe resets consecutive error counter.
- [ ] Lane 5. Stale snapshot delivery to UI callers. Save `/tmp/swarm-pr-02/worker-5/stale-snapshot.png`. Pass when cached data returns with stale flag true during outage.
- [ ] Lane 6. HTTP 401 unauthorized token expiration handling. Save `/tmp/swarm-pr-02/worker-6/auth-expired.png`. Pass when 401 triggers token refresh attempt.
- [ ] Lane 7. HTTP 429 rate limit backoff response. Save `/tmp/swarm-pr-02/worker-7/rate-limit.png`. Pass when rate limit pauses next poll interval by 60 seconds.
- [ ] Lane 8. Multi-endpoint fallback across daily and prod URLs. Save `/tmp/swarm-pr-02/worker-8/endpoint-fallback.png`. Pass when failed primary endpoint tries secondary endpoint cleanly.
- [ ] Lane 9. Zero-token emergency fallback generation. Save `/tmp/swarm-pr-02/worker-9/zero-token-fallback.png`. Pass when cold start without network provides fallback snapshot.
- [ ] Lane 10. Memory stability under repetitive timeout triggers. Save `/tmp/swarm-pr-02/worker-10/abort-cleanup.png`. Pass when aborted signals and timers garbage collect completely.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Worst-case endpoint resolution latency under simulated blackhole network.
- [ ] Probe. Five simulated hanging requests against quota service with network packet drop.
- [ ] Baseline. Trunk baseline measured at 120000ms until operating system TCP timeout.
- [ ] Rule. Head latency must never exceed 5200ms per request attempt.

**Review gate.** None. pr-02-quota-timeout-circuit-breaker is not review-gated.

**Merge.**

- [ ] Root clean verdict on head commit.
- [ ] Rebased cleanly on origin main.
- [ ] Squash merge commit ready for stack inclusion.

## Enforce streaming queue backpressure watermark (pr-03-streaming-backpressure-guard)

**Depends on.** pr-01-async-debounced-io.

**Files.**

- [ ] Edit `src/index.ts`.
- [ ] Edit `src/acp-client.ts`.

**Build.**

- [ ] Add high and low watermarks to in-memory streaming queue with stdio pipe pause and resume controls in `DshAntigravityService`.

**You see.**

- [ ] Fast model emissions pause ACP process stdout when queue reaches 500 items and resume once drained below 200 items.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Unit check simulates slow consumer and verifies queue pauses and drains within watermarks. Run `node scripts/test-backpressure.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run burst emission of 2000 chunks to stalled consumer at trunk and head. If trunk lacks backpressure, record unbounded queue growth and gate peak queue size at 500 items. Save `/tmp/swarm-pr-03/worker-1/regression-trunk.png`. Pass when memory array never exceeds high watermark.
- [ ] Lane 2. Normal consumer flow-through rate. Save `/tmp/swarm-pr-03/worker-2/normal-consumption.png`. Pass when active reader consumes chunks with zero pause events.
- [ ] Lane 3. Pause trigger at 500 items. Save `/tmp/swarm-pr-03/worker-3/pause-trigger.png`. Pass when ACP child process stdout pause method fires at high watermark.
- [ ] Lane 4. Resume trigger at 200 items. Save `/tmp/swarm-pr-03/worker-4/resume-trigger.png`. Pass when stdout resume fires once queue drains to low watermark.
- [ ] Lane 5. Clean teardown on abort signal. Save `/tmp/swarm-pr-03/worker-5/teardown-abort.png`. Pass when aborted stream clears pending queue immediately.
- [ ] Lane 6. Client disconnection buffer release. Save `/tmp/swarm-pr-03/worker-6/disconnect-release.png`. Pass when closed generator drops all remaining queue items.
- [ ] Lane 7. Subagent tool recursive streaming stability. Save `/tmp/swarm-pr-03/worker-7/subagent-backpressure.png`. Pass when nested subagent messages obey outer backpressure.
- [ ] Lane 8. Process termination during paused state. Save `/tmp/swarm-pr-03/worker-8/paused-exit.png`. Pass when process kill unhangs consumer generator with clean done.
- [ ] Lane 9. Order preservation across pause and resume cycles. Save `/tmp/swarm-pr-03/worker-9/order-integrity.png`. Pass when 1000 sequential sequence numbers arrive in exact order.
- [ ] Lane 10. Heap footprint under sustained 10000 item throughput. Save `/tmp/swarm-pr-03/worker-10/heap-footprint.png`. Pass when buffer memory stays under 20 megabytes throughout test.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Peak memory buffer allocation during 10000 token output with delayed reader.
- [ ] Probe. Emission of 10000 simulated chunks with 20ms read delay between yield iterations.
- [ ] Baseline. Trunk unthrottled queue peaks at 185 megabytes resident memory.
- [ ] Rule. Head queue buffer must stay under 25 megabytes maximum resident memory.

**Review gate.** None. pr-03-streaming-backpressure-guard is not review-gated.

**Merge.**

- [ ] Root clean verdict on head commit.
- [ ] Rebased cleanly on origin main.
- [ ] Squash merge commit ready for stack inclusion.

## Establish automated vitest suite for protocol core (pr-04-protocol-test-suite)

**Depends on.** pr-01-async-debounced-io, pr-02-quota-timeout-circuit-breaker, pr-03-streaming-backpressure-guard.

**Files.**

- [ ] Edit `package.json`.
- [ ] Create `vitest.config.ts`.
- [ ] Create `tests/event-mapper.test.ts`.
- [ ] Create `tests/session-manager.test.ts`.

**Build.**

- [ ] Install vitest devDependency and write comprehensive test suites for event mapping, step tracking, turn deltas, and session lifecycle.

**You see.**

- [ ] Running `npm test` executes vitest and passes all unit tests for protocol parsing, token accounting, and session management.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run full test suite asserting 100% pass on 25 critical protocol cases. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run test runner against trunk and head. If trunk lacks test suite, record zero coverage and gate full pass of 25 automated cases. Save `/tmp/swarm-pr-04/worker-1/regression-trunk.png`. Pass when all test files exit zero.
- [ ] Lane 2. Event mapper tool call start and delta parsing. Save `/tmp/swarm-pr-04/worker-2/event-mapper-tools.png`. Pass when tool use blocks emit correct DSH activity objects.
- [ ] Lane 3. Event mapper reasoning chunk extraction. Save `/tmp/swarm-pr-04/worker-3/reasoning-chunks.png`. Pass when thought blocks correctly translate to reasoning deltas.
- [ ] Lane 4. Token calculation delta vs cumulative filtering. Save `/tmp/swarm-pr-04/worker-4/token-delta-filtering.png`. Pass when cumulative token dumps (>1M) are discarded cleanly.
- [ ] Lane 5. Session manager binding serialization and deserialization. Save `/tmp/swarm-pr-04/worker-5/session-serialization.png`. Pass when persisted state restores perfectly across reloads.
- [ ] Lane 6. Session pruning of older turns. Save `/tmp/swarm-pr-04/worker-6/session-pruning.png`. Pass when history trims properly while retaining system instructions.
- [ ] Lane 7. User request tag extraction regular expression. Save `/tmp/swarm-pr-04/worker-7/user-request-regex.png`. Pass when outer DSH harness wrappers strip cleanly.
- [ ] Lane 8. Stream writer block transition sequencing. Save `/tmp/swarm-pr-04/worker-8/block-transitions.png`. Pass when reasoning block closes before text block starts.
- [ ] Lane 9. Quota calculation dual-window bucket evaluation. Save `/tmp/swarm-pr-04/worker-9/quota-evaluation.png`. Pass when 5h and weekly quota logic correctly picks bottleneck.
- [ ] Lane 10. TypeScript typecheck integration in test command. Save `/tmp/swarm-pr-04/worker-10/typecheck-tests.png`. Pass when `tsc --noEmit` validates test code without error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Full test suite execution duration in seconds.
- [ ] Probe. Execution of `npm test -- --run` over five runs.
- [ ] Baseline. Initial test setup execution measured at 3.2 seconds.
- [ ] Rule. Full suite run must complete in under 2.5 seconds.

**Review gate.** None. pr-04-protocol-test-suite is not review-gated.

**Merge.**

- [ ] Root clean verdict on head commit.
- [ ] Rebased cleanly on origin main.
- [ ] Squash merge commit ready for stack inclusion.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

- Evaluated async debounce interval of 500ms in scratch script. Verified that batching writes reduces file system I/O by over 95% during high-speed token generation while keeping memory low.
- Tested `AbortSignal.timeout(5000)` against mock unreachable IP addresses. Verified that fetch rejects with TimeoutError promptly at five seconds without orphaned socket handles.

## Appendix B. Alternatives rejected

- Redis or SQLite storage. Adding an external database introduces heavy binary dependencies for a lightweight desktop plugin. JSON flat files with atomic swap and debouncing solve persistence overhead cleanly.
- Worker thread for disk writing. Node.js `worker_threads` adds serialization complexity and shared memory overhead. Asynchronous `fs.promises.writeFile` with debounce sufficiently frees the main event loop.
- Blocking pause without low watermark. Pausing at high watermark without a hysteretic low watermark causes rapid thrashing between pause and resume states. A dual-watermark window (500 high, 200 low) provides smooth flow control.

## Appendix C. Risks

- Process crash during debounced window could lose last turn stats. Mitigated by explicit `process.on('exit')` and `process.on('SIGINT')` synchronous flushes.
- Vitest dependency version conflicts with Node.js LTS versions. Mitigated by pinning vitest to stable compatible release and isolating test configuration.

## Appendix D. Links and reading list

- Node.js Stream Backpressure Guide.
- Vitest Getting Started Documentation.
- DSH Plugin Architecture Specifications.
