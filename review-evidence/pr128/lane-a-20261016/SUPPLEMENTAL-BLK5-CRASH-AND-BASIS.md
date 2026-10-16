# C6 PR #128 Lane A — supplemental BLK-5 crash-cut and action-basis diagnostic

Status: DIAGNOSTIC REVIEW EVIDENCE, NOT FORMAL HEAVY ZERO BLOCKERS, NOT ACTIVATION PROOF
UTC evidence date: 2026-10-16

## Exact pinned basis
- Repository: Stanislavikus/babypark-integration (never babypark-b2b)
- PR: #128 (Draft, unmerged)
- HEAD: aadc8f4dafb14fa0f659653c0edd5a727bebea4b
- TREE: c0e91285ffc40e12ea202775f26240eb3d407a35
- CAMPAIGN_BASE_OID: 0dfb9b0a1cfe23d455fd436ae9abeac626d0d729
- origin/main at verification: f3d92325e6b4ef04f0137c4c49dde07c05731bbe
- governance blob: e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
- frozen required manifest SHA-256: 6e1b7ba9edb8ac223ded83d9adf7d96aa47c7038296353d072e4a72c1ed73626
- manifest evidence commit: 2ceac32d024b8a2e54cfb9483e4014d07d0cc0a6

## Independent verification of manifest fields (not just trust in report)
On exact clean HEAD/TREE, read manifest, prove campaign base git commit exists, run base-scoped git diff --check and diff --name-status. Compare every one of 77 changed-path {status,path,class} records byte-for-byte against the manifest. Result PASS. Re-read origin/main governance blob via Git tree lookup: e777fce4af8e8c3372f1f9de9ef7d00f786c2c89, matching manifest. Manifest SHA-256 independently recomputed and matched.

## BLK-5 custom adversarial crash-cut diagnostics on unchanged source
Executed synthetic standalone scratch test (reproducible source supplied separately):
- Test scenarios: 13, PASS 13/13, FAIL 0.
- Each test captures the complete state of conversation_streams, conversation_events, semantic_origins, continuation_owners, public_actions, deferred_event_parents, public_action_human_cuts and episodes.
- It installs an abort trigger on one mutation during ingestVerifiedChatwootEvent. Injection points include initial event insert; semantic origin insert; PREPARED/GATING action terminalization; same-revision owner transfer; SENDING/UNCERTAIN deferred_parent insert; SENDING/UNCERTAIN public_action_human_cut; and event append under preexisting HUMAN.
- It asserts the whole SQLite state is identical to the pre-attempt snapshot both before and after process-style close/reopen; retries after the synthetic fault is removed, checks idempotency and durable HUMAN.
- Command (synthetic scratch clone under tests/unit): node --test --test-concurrency=1 tests/unit/blk5-crashcut-diagnostic.test.mjs
- Source SHA-256: f1631687010e4c52e1f36d6fc534b3889615f79c411d610f8bf5ed1c14a7f396
- Result log SHA-256: b3438f18c42d8a2e54993d74c6dceb6f9e4590aa31d9e2cff365752fee6dd216
- These probes are ADDITIONAL DIAGNOSTICS, not immutable-OCI qualifying checks, and test transaction rollback, not an actual OS crash or genuine Chatwoot delivery.

## Action basis completeness
1. Low-level FirstLineStateStore.preparePublicAction accepts basisEventSeqs=[2] at revision 2 even if the certified OPEN_TURN projection contains [1,2]. Reproduced using tests helper: diagnostic 1/1 PASS; log SHA-256 1b3e6d7ecd21806c88b817bf2a7c6f713a1819cad05522a11b685622cb8e5047. This is an internal-API hardening gap, NOT demonstrated production public-send exploit.
2. Actual production caller prepareFirstLinePublicActionFromCandidate copies basisEventSeqs directly from frozen projection.open_turn.event_seqs, requires a WeakMap-certified original candidate bound to the exact store/stream. A synthetic *genuine candidate* created with two existing customer messages produced OPEN_TURN [1,2] and a prepared action whose basis exactly equals [1,2]. The original suite plus this additional diagnostic passed 7/7; log SHA-256 adc5fc94bd25c4d6839f444c2b3043c1e7948ffbdf6661ea554378b10bd1db2f.
3. S2 exact send authorization separately compares action.basis_event_seqs to the genuine candidate's projection.open_turn.event_seqs by isDeepStrictEqual and denies mismatch with HUMAN_REQUIRED / S2_ACTION_DESCRIPTOR_MISMATCH. No supported customer-facing send bypass from the low-level partial-basis write was identified. Do not conflate this with store-level contract validation; consider hardening in a separately owner-approved scope only if HEAVY reviewers classify it material.
4. Genuine candidate construction rechecks stream revision and exact transient source topology, then must pass fresh S2 reauthorization and current Chatwoot history before any public POST.

## Prior immutable-input OCI evidence on same exact HEAD
- Container immutable image ID: sha256:f7dd6300c82e401c82530054cbbb05d883536793e3176de47cdcb453a8c85cd8
- Fresh npm ci from bound lock; each suite uses read-only source/deps and separate fresh no-network tmpfs.
- storage:validate PASS, unit 1362/1362, legacy 13/13, refactor 13/13; root npm test EXIT 0, no fail.
- Root npm test log SHA-256: 1dda89e61b07cee52a0cc416f3cb07dbd174bdd013408f2f92f2c52f36416a62
- Exact Git HEAD, TREE and clean status confirmed after each suite.

## Review outcome and explicit exclusions
No NEW BLK-5 crash atomicity violation observed in the 13 injected cuts. No supported customer-facing incomplete-action-basis path shown. This is one limited supplementary pass, NOT ZERO BLOCKERS for all Lane A surfaces and NOT a blind second independent HEAVY confirmation.
Real Chatwoot v4.18/current deployment version, 4xx/429/5xx behavior, operator-facing HUMAN alert, B2 restore, load/chaos and activation are not attested here. PR #128 remains Draft; no merge, deploy, customer traffic or core patch authorized.
