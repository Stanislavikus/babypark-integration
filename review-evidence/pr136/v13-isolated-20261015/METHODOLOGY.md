# PR #136 — Independent HEAVY V13 confirmation methodology

Status: EVIDENCE — NON-NORMATIVE  
Applies to: Stanislavikus/babypark-integration Draft PR #136 isolated confirmation pass  
Normalization: UTF-8, LF, exactly one terminal newline  
Reviewer context: run-independent; no R1 transcript, findings, or conclusions consumed  

## Frozen campaign basis (immutable input)

| Field | Value |
| --- | --- |
| Campaign HEAD | `262f7a8999d797f4ceceb531004986cfd6667d73` |
| Campaign TREE | `ffb8953002feaeb5f417a09a832c86f24051afa2` |
| CAMPAIGN_BASE_OID / canonical main at freeze | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| Governing Agreement blob (git) on base | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Agreement content SHA-256 (UTF-8 bytes) | `c63644eadd35856b7bc06fddf163e10b0219ea3ff9f513250c1409aff9be2ed6` |
| Frozen manifest path | `review-inputs/pr136/required-verification-manifest.txt` @ evidence commit `f8b03db5f22b8dd86bebbc6df37ef66855a034b3` |
| Frozen manifest SHA-256 | `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6` |
| HEAD Design blob | `9fbca03b302fba4c575d4c97ad989e81091808d2` |
| HEAD Acceptance blob | `14d0cd0cc8c459ed17b16dff2b3882128b4d88ff` |

## Bootstrap (Agreement §12)

1. Authenticated `origin` → `Stanislavikus/babypark-integration` (HTTPS remote URL redacted in logs).  
2. Listed `docs/` fresh (68 entries); snapshot `v01/docs-list-workspace-bootstrap.txt`.  
3. Fetched `origin/main` OID `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`; equals campaign base and merge-base with HEAD.  
4. Read full `docs/AI_WORKING_AGREEMENT.md` from canonical main; governance tuple matches manifest.  
5. No amendment-branch stale-base condition; ordinary-work tuple applies.

## V01–V04 execution gate (Agreement §7.0a)

**Immutability model (docs-only surface):** No `npm`/`node_modules` required by frozen manifest. For each mandatory Git command, a **new** detached `git worktree` at campaign HEAD was created, tracked tree chmod `a-w` for command lifetime, empty index/worktree verified pre/post, then worktree removed. Toolchain: `git` 2.43.0 at `/usr/bin/git`, SHA-256 `2a8c18fbf43da9f692d75474c72bea9dfd796c260b0f3dfe456376abc3bbd668`. Node v22.14.0 recorded; not invoked for required checks.

**Per-check materializations:**

| Check | Worktree evidence dir | Command | Exit | stdout SHA-256 | stderr SHA-256 |
| --- | --- | --- | --- | --- | --- |
| V03 | `v03-isolated/` | `git diff --check "${CAMPAIGN_BASE_OID}..HEAD"` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | same empty |
| V04 name-status | `v04a-isolated/` | `git diff --name-status …` | 0 | see `v04a-isolated/digests.txt` | |
| V04 stat | `v04b-isolated/` | `git diff --stat …` | 0 | see `v04b-isolated/digests.txt` | |
| V04 full patch | `v04c-isolated/` | `git diff …` | 0 | patch `cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714` | |

`CAMPAIGN_BASE_OID` proved nonempty; `git cat-file -e` on base commit before each base-scoped command.

Changed surface (only): `M docs/AI_FIRST_LINE_ACCEPTANCE.md`, `M docs/AI_FIRST_LINE_DESIGN.md` (+194/−79 lines).

## V05–V10 substantive protocol

- Read complete HEAD and BASE blobs for `docs/AI_FIRST_LINE_DESIGN.md` and `docs/AI_FIRST_LINE_ACCEPTANCE.md` via `git show` (no PR/R1 transcript).  
- Read governing Agreement §§1–3, 5–9, 11–13 and applicable §7.0/7.0a/7.1 for HEAVY docs-only gate.  
- Cross-checked §29.8.2–§29.8.3 Lane A/B carve-outs against Q39a(6–8), Q39b matrix/Expected, §43/B2 activation language, Scan/Fit separation, numeric authoring bans, native callback matrix retention, measurement/activation separation (V10), fail-closed unknowns.

## V11 live PR attestation

- GitHub REST `GET /repos/Stanislavikus/babypark-integration/pulls/136` at UTC in `v11-fetch-meta.txt`, HTTP 200.  
- `head.sha` = campaign HEAD; `base.sha` = campaign base.  
- PR `body` UTF-8 field SHA-256: `bb25e5ff09cd35379effe94c00b54e6dda958e750fe22870df781b988a846b7e` (raw bytes `v11-pr136-body-utf8-bytes.bin`).  
- Independently verified manifest file bytes SHA-256 `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`.  
- R136-01…R136-08 table present in live body with clause mappings; all rows `IN PROGRESS` (expected pre-closure; not merge authorization).

## V12 exhaustive adversarial review

Continued past first pass; clustered independent BLOCKER classes (see `V13-VERDICT.md`). Structural probes: no known unsafe §29.8 phrases; Q39a cases 6–8 present; diff adds no Q39c/reliability-objective gate text.

## V13 confirmation

Independent context-isolated pass; reproduces V01–V12 on identical tuple/manifest digest; emits verdict file and this methodology digest.

## Methodology content digest

Record separately after normalization: see `METHODOLOGY.sha256` in this directory.
