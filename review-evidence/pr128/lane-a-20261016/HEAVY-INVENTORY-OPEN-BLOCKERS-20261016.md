# PR #128 C6 Lane A / Full Runtime HEAVY — adversarial inventory checkpoint (NOT ZERO)

Status: **EVIDENCE — NON-NORMATIVE; OPEN BLOCKERS; NOT A ZERO-BLOCKER REVIEW; NO MERGE OR ACTIVATION AUTHORITY.**  
Applies to: `Stanislavikus/babypark-integration` PR #128 C6 CP1–CP5 implementation, excluding unrelated repositories.  
Supersedes: none; this is a supplemental first-HEAVY inventory checkpoint.  
UTC: 2026-10-16, isolated synthetic/rehearsal environment, no actual Chatwoot/customer traffic.

## Immutable exact basis

- Campaign HEAD: `aadc8f4dafb14fa0f659653c0edd5a727bebea4b`
- Campaign TREE: `c0e91285ffc40e12ea202775f26240eb3d407a35`
- Campaign BASE: `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`
- Canonical main: `f3d92325e6b4ef04f0137c4c49dde07c05731bbe`
- Governance blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- Frozen manifest: `6e1b7ba9edb8ac223ded83d9adf7d96aa47c7038296353d072e4a72c1ed73626`, 77 exact source paths matched; manifest evidence commit `2ceac32d024b8a2e54cfb9483e4014d07d0cc0a6`.
- PR remained Draft/unmerged, and this inventory did not move its HEAD or modify the source tree.
- Previous pinned immutable OCI: root `npm test` 1362 unit/13 legacy/13 refactor PASS and storage:validate PASS, but green test outcome is not HEAVY ZERO.

## BLK H-ING-01 — ingress callback timing/admission and budgeting

**Trace:** `src/copilot/first-line-runtime-ingress.mjs` enforces a 1 MiB aggregate body cap, but `createFirstLineAgentBotServer` lacks its own body-receipt deadline, finite concurrent admissions `N`, cumulative work/replenishment cap and bounded rejected/slow-body resource cost. The exact authority reader in `src/copilot/chatwoot-client.mjs` defaults to `requestTimeoutMs=5000`; `FirstLineStateStore` has fixed `BUSY_TIMEOUT_MS=5000` with no per-ingress measured `PRAGMA` read-back. No positive target-safe I/R_seq/C_sync/K/B_site/Q/O/M envelope is wired at startup. Synthetic diagnostic starts 12 partial-Content-Length HTTP requests on localhost: all 12 sockets remain held, no relay call, Node v22.23.3 server defaults `requestTimeout=300000` ms, `headersTimeout=60000` ms. This is not evidence of a full 300-second end-to-end service delay; it proves no enforced five-second body/admission envelope.

**Violated:** merged frozen `docs/AI_FIRST_LINE_DESIGN.md` §29.8.3 ingress-only timing feasibility, explicit finite N, body deadline, cumulative load, connection-specific timeout and positive budget; `docs/AI_FIRST_LINE_ACCEPTANCE.md` timing matrix; governance §§1,5,7.0a. Planning evidence already identified D1/D2/D5/D6/D9/ING-2; do not incorrectly claim it was newly unknown.

**Minimal correction direction (not authorized by existing BLK-1…6 GO):** separately bind current native/OSS alternatives scan, measured ingress fit and owner GO; implement validated admission/body/deadline/envelope controls from target-matched measured allocation, keep one owning SQLite tx and zero public writes; refuse startup where bounds unproven. **Regression:** slow-body/over-N/replenishment/rejected storms, bounded header/body/timeouts, mock REST stall, SQLite high-timeout competitor/cache spill/read-back, single process/restart, 4xx/429/5xx matrix as applicable. No guessed numeric defaults.

**Synthetic evidence:** source SHA-256 `20ae6784cab44bd1f56a2dfd761f8348e944952c22a726eb3315e4ab1cbc01c0`; TAP log SHA-256 `1e315963892dc9c549cc917aa7400d5e11b5a720fee4aa0e446cca11ce538784` (1/1 PASS validating the bad current-state observation). No customer data.

## BLK H-LIVE-02 — S2 refusal with expired GATING lease lacks durable HUMAN

**Trace:** genuine C4 candidate -> PREPARED -> claimed GATING for 10,000-ms synthetic lease -> store clock advanced 20,000 ms -> `gatePublicActionToSending()` S2 action match fails, then catches `store.escalatePublicActionToHuman()` lease-expired exception and returns `HUMAN_REQUIRED` with `continuationOwner:null`. Durable action remains `GATING`, unresolved owner remains `PUBLIC_ACTION`. No POST is performed. `runFirstLinePostSendRecoverySweep` explicitly skips PREPARED/GATING; its candidate service treats such rows as incomplete/fatal, and cannot independently complete the HUMAN obligation. This is separate from BLK-6 deferred-parent topology or ingress webhook F1-R.

**Violated:** merged DESIGN §29.7.2 S2 denial/handoff, §29.8.2 liveness and ACCEPTANCE same-revision rejection/HUMAN cut. Reporting a transient HUMAN_REQUIRED is not a durable owner transfer.

**Minimal correction direction:** define verified atomic expired GATING pre-send reclaim/terminalization + durable HUMAN cut, preserving CLARIFY counters and fencing any old worker; provide bounded CP4 liveness/recovery for PREPARED/GATING. No unconditional stale-owner rewrite. **Regression:** real candidate × active/expired lease × refusal reasons, clock/deadline boundary, abrupt restart/crash after each DB mutation, concurrent stale-worker SENDING CAS attempt; invariant 0 POST, exactly one durable HUMAN or provably safe current action.

**Synthetic evidence:** source SHA-256 `e6abc46aec48b63303facb5bd93a7bb5ed685ffc351168765149232d54990458`; TAP log SHA-256 `662b041890d98276ea0fed6df8cb33b498dd12daacb00337498abcf3f5f8387c`; 7/7 PASS verifying explicit bad-state assertion, independent of production credentials.

## BLK H-S2-03 — full Chatwoot history finds unseen source but S2 never ingests it

**Trace:** true-backed candidate from one accepted customer source 101, current *synthetic* whole-conversation authority reports 101+102. `assessFirstLineS2Preflight` returns `STALE / S2_HISTORY_TOPOLOGY_CHANGED` on `snapshot.events.length !== durable.length`, without admitting 102. DB revision remains 1, ledger remains [101]. This denies POST (good), but does not implement the mandatory idempotent ledger convergence from complete Chatwoot history if a webhook was lost. This is not evidence that a live webhook was lost.

**Violated:** merged DESIGN §29.7.2 step 2 (default-deny classify and idempotently ingest unseen source keys before S2 continuation) and associated recoverability requirement. The logic's comment delegates to a future normal inbound adapter; that is not equivalent to attested S2 history convergence.

**Minimal correction direction:** in the single owning-store protocol, classify/append missing supported/unsupported events with fresh exact authority and all HUMAN/deferred/fail-closed protections before any new S2 send proof. Keep no customer body/digest durable. **Regression:** synthetic complete 101+102 with missing 102 webhook; dedup/retry; unknown/changed source 409/HUMAN; adversarial race with simultaneous ingress, lease expiry and restart; no POST based on stale S1.

**Synthetic evidence:** source SHA-256 `09afa3aa48814c60b981e0f37f5fe372e757107e4e82a7f51b491c94dc50cb07`; TAP log SHA-256 `189562f886f9965d8aac490bc568f53661e38ec4e57dbedc45387b178a1521e8`; 7/7 PASS verifying observed non-convergence.

## Gate blocker H-MAN-04 — frozen required-verification manifest cannot support closure as-is

The current frozen manifest lists 11 checks, including root `npm test`, native updates, deferred state-space and restart recovery, but not §29.8.3 mandatory ingress timing/admission/lock/overload evidence or a maintained red-to-green check for H-LIVE-02/H-S2-03. The actual code-stage requirements are not waived by omitting them. Under governance §7.0a, a manifest-byte change **invalidates** existing zero closure and requires all required checks/reviews to rerun on the new exact basis. No manifest change made during this inventory. At the time of this checkpoint no zero closure had been declared.

## NON-BLOCKING + known external gates

- Internal `preparePublicAction` permits incomplete basis but production C4 candidate derives full certified OPEN_TURN basis and S2 compares exact `action.basis_event_seqs` to genuine candidate via `isDeepStrictEqual`. Reproduced elsewhere and confirmed independently by Sonnet. Hardening internal API desirable, no proved public-send bypass.
- Current candidate CP4 postsend recovery enumerates all eligible actions without batch bound and skips unsent phases; its co-residence/response-budget and operator-alert rollout remain gates. Part of H-LIVE-02 and H-ING-01 until distinct independent cause shown.
- Real deployed Chatwoot version/native retry/error effects, operator-visible HUMAN attention, measured workload, B2 recovery/restore and separate production owner GO are still not proven here. Synthetic 422/503/200 outcomes cannot substitute for native effects.

## Disposition

This is an exhaustive-*seeking* first-HEAVY checkpoint that **continued past the first finding**, NOT a certificate that the complete CP1–CP5 surface has been exhausted. Known independent source-level classes H-ING-01, H-LIVE-02 and H-S2-03 remain open; H-MAN-04 blocks frozen-manifest completeness. **HEAVY ZERO BLOCKERS is forbidden** on HEAD `aadc8f4d...`. No fix made; these production-code directions exceed the owner's narrow existing BLK-1…6 authorization. Batch scope/scan/fit must be reviewed and expressly approved before new production-code work. PR #128 stays Draft; no merge, public AI, real customers or deployment.
