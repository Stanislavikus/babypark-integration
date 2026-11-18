# BabyPark V4.2.1 OEM-fitment — Stage C (S5–S6) recovery checkpoint

Status: EVIDENCE — NON-NORMATIVE recovery checkpoint and index. READ-ONLY handoff; it authorizes no code, rollout or production change.
Applies to: branch `feat/v421-oem-stage-c-20261118`, `rehearsal/v421-oem-stage-c/` and `docs/oem-stage-c-20261118/` only.
Supersedes: none. It indexes `STAGE_C_RESULT_20261118.md` and `STAGE_C_REHEARSAL_RUNBOOK_20261118.md`; it does not replace them.

This document is not a production, rollout or publishing authorization. It does not approve OD1–OD8, does not claim any reviewer or owner approval, and Stage C is not accepted. DO_NOT_MERGE: YES. PRODUCTION IMPLEMENTATION: NO.

## 1. Anchors

- Repository: `Stanislavikus/babypark-integration`. Canonical Stage A documents (frozen, never edited): `docs/oem-review-20261117/`, in particular `STAGE_B_EXECUTION_LOCK_20261117.md` and `RECOMMENDED_IMPLEMENTATION.md`.
- Stage B (S0–S4) is ACCEPTED by the independent reviewer on rehearsal, scope S0–S4 only: protocol `https://github.com/Stanislavikus/babypark-integration/pull/168#issuecomment-6971608485`; accepted HEAD of PR #168 `39c9bbb6486d571207891e7e9892636f36b8014c`; its base `eedaf7746d92185f3082d24b8125fa6aded0a6ce`. PR #168 stays Draft / DO NOT MERGE and was not touched by Stage C.
- Stage C branch: `feat/v421-oem-stage-c-20261118`, cut from the accepted Stage B HEAD; Draft PR #169 (base `feat/v421-oem-stage-b-20261117`). The delivered Stage C HEAD is named in the pull request description and in the hand-off message: a document cannot contain the SHA of the commit that contains it.
- Accepted real shadow result that Stage C builds on: 43 relations (23 `accessory_for_model`, 19 `adapter_between`, 1 `vehicle_general`), 41 effective `UNKNOWN`, 2 `CONFLICT_HOLD`, 0 publishable, 0 active veto; all 53 real claims `PROPOSED`; `oem_relations.json` SHA-256 `7c606903c1861d1399457be812bcdf76e2f81951838d18275d69e6cc0691f44e`.
- Frozen corrected baseline (campaign `/opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117/`): 28,769 catalog rows, 8,129 sources, 1,832 stroller + 42 car-seat links, V3.6 Similar unchanged.
- Accepted engine file: `work/accessories/src/accessory_v4.py`, SHA-256 `20c12303543fa7c4a522cc28ea5f4dc698098b0093ccf14fa066f9d67f7be2e8`. It is never modified. The Stage C seam is a patched copy with pinned digests (`rehearsal/v421-oem-stage-c/engine_seam/ENGINE_SEAM_PINS.json`): patched file `57310d4c78b1906f2547c4361b404baaa1f53cf486f2b8e5b4c05508f7d3ab8f`, reviewable diff `rehearsal/v421-oem-stage-c/engine_seam/accessory_v4_stage_c.patch` `21952b93cd8f5e6614041aed21cf1332ee3163e294b52b63dbf6f78dcf08493a` (+180 / −1 lines).

## 2. What Stage C is

The lock's S5 and S6 and nothing else: an optional, OFF-by-default seam in the existing `build_catalog()`; a consumer-side gate that admits only truly VERIFIED, unconditional, non-synthetic relations (cross-brand allowed, adapters only with both physical ends); a replay of the accepted corrected generation with the seam OFF (must reproduce it) and ON (every difference explained); and preparation for the existing native Stage1 gate. It reuses the accepted Stage B package read-only and adds no new architecture, service or dependency (Hypothesis stays test-only; C-D5, owner go-ahead NOT received).

Index (all under `rehearsal/v421-oem-stage-c/`; the full list with digests is `docs/oem-stage-c-20261118/STAGE_C_FILES_SHA256.txt`):

| Area | Files |
|---|---|
| Gate and contract | `oem_intake/gate.py`, `oem_intake/envelope.py`, `tools/build_accepted_edges.py`, `docs/DATA_SCHEMA.md` |
| Engine seam | `engine_seam/accessory_v4_stage_c.py`, `engine_seam/accessory_v4_stage_c.patch`, `engine_seam/seam_helpers.py.txt`, `engine_seam/ENGINE_SEAM_PINS.json`, `tools/build_engine_seam.py` |
| S6 replay and diff | `tools/replay_stage_c.py`, `tools/stage_c_launcher.py`, `oem_intake/replay_diff.py` |
| Stage1 preparation | `oem_intake/stage1.py`, `tools/stage1_plan.py` |
| Verification tooling | `tools/mutation_check.py`, `tools/verify_scope.py`, `tools/files_manifest.py`, `tools/relation_decisions.py`, `tests/` |
| Governance | `docs/oem-stage-c-20261118/S5_GOVERNANCE_RECORD_20261118.md`, `docs/oem-stage-c-20261118/S5_ALTERNATIVES_SCAN_20261118.md`, `governance/` |
| Results | `docs/oem-stage-c-20261118/STAGE_C_RESULT_20261118.md`, `out/MUTATION_CHECK.json`, `out/real_relations/` |

## 3. State at this checkpoint

- Everything was implemented and tested in a cloud sandbox against a copy of the accepted V4.2.1 engine; nothing was run on the rehearsal host `babypark-catalog-rehearsal-fra1`. The complete corrected replay (28,769 rows / 8,129 sources / 1,832 + 42 links) was NOT run: the exact commands are in `STAGE_C_REHEARSAL_RUNBOOK_20261118.md`.
- Real OEM page bytes, human reviews and Stage1 receipts do not exist. Every real relation is held; with the default policy and an empty owner allow-list the gate accepts nothing, so feature ON on the real catalog is expected to equal OFF (deduced, not observed; the relation-level part is pinned by `tests/test_real_relations_held.py`). No synthetic evidence was ever used for the real catalog.
- No production, `main`, PR #167 or PR #168 change. No recommendation was published. Veto is report-only. OD1–OD8 remain pending owner decisions with the safe defaults.

## 4. What is needed next (none of it is done or pre-approved here)

1. An independent run of the rehearsal runbook (or a granted bridge so that the author can run it): seam check, tests, baseline, gate, OFF/ON replay, Stage1 plans, mutation check.
2. Real OEM evidence: capture the original pages (bytes, SHA-256), record claims with Stage B's `tools/evidence_cli.py`, and have a different person verify each against the ORIGINAL document (OD1). Only then can a relation pass the gate.
3. Native Stage1 receipts for the up-to-8 currently `status=1` accessory target-locales from the lock (2000030111, 11006001par, 1166057110, 400019001, each RU/UK) and their source contexts. `400003001` RU/UK is `field_status=3` and cannot be recommended.
4. Owner decisions OD1–OD8 and the Hypothesis go-ahead (C-D5 / Stage B D2). A taxonomy / commercial decision is needed before adapters on car-seat sources or adapters that require an extension can ever be published (the seam holds them by design).
5. Independent acceptance of Stage C. Only after it: formal process closure, a separate publication decision and any rollout, each with its own approval.

## 5. Resuming in a new session

Run the repository bootstrap of `docs/AI_WORKING_AGREEMENT.md` section 12 first, then `AGENTS.md` and `docs/CURRENT_STATE.md` (not edited by Stage C). Read, in this order: the lock, this checkpoint, `STAGE_C_RESULT_20261118.md`, `S5_GOVERNANCE_RECORD_20261118.md`. Reply in the user's language (Russian). Sandbox hints that may not persist: the engine copy is passed through `BP_V421_ENGINE_ROOT`; the sandbox-only import shim is Stage B's `tools/sandbox_opt_shim.sh`; tests run with `python3 -B -m unittest discover -s tests -t .`; the sandbox cannot push with a plain `git push` negotiation and uses `git -c push.negotiate=true push -u origin <branch>`. A portable `git bundle` of the branch is sent with the hand-off; its SHA-256 is given in the hand-off message, not here.

Do NOT: change `main`, production, PR #167, PR #168, the accepted engine in place, V3.6 Similar, the corrected snapshot or any frozen Stage A / Stage B document; confirm OEM evidence on anyone's behalf; enable OD1–OD8 or the veto; publish recommendations; fabricate `VERIFIED` evidence or Stage1 receipts for the real catalog; start a rollout; claim real-replay results that were not observed.

## 6. Integrity

`docs/oem-stage-c-20261118/STAGE_C_FILES_SHA256.txt` lists the SHA-256 of every file of both Stage C directories (`sha256sum -c` format; `tools/files_manifest.py --check` verifies it). It cannot contain its own digest; the digest of the manifest and the HEAD SHA are given in the pull request and in the hand-off message.
