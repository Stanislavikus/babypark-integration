# Codex — BabyPark AI Seller PoC-0 — bounded read-only preparation

Status: EVIDENCE / TASK PROPOSAL, NON-AUTHORIZING.
Applies to: ONLY `Stanislavikus/babypark-integration`. Do not reference `babypark-b2b`.

## Intended outcome
Supply a **read-only preflight report** making a real n8n/Claude smoke possible immediately after the separate Scope Change merge and SHA-bound owner GO. Do not review architecture anew; do not edit code or documentation, create a production snapshot, write Git or n8n, call any Anthropic API, buy anything, change Docker settings, transfer customer data, or activate a workflow. Everything else is OUT OF SCOPE.

## Bootstrap first
Freshly enumerate GitHub `docs/` and fully read canonical `origin/main:docs/AI_WORKING_AGREEMENT.md`; authenticate `Stanislavikus/babypark-integration`. Record canonical main, tree, Agreement blob and validate the exact base; never move/rebase an unrelated campaign or PR. Stop if governance conflicts.

## Read-only EB2 inventory — historical catalog
- Look for the **retained, existing, verified artifact** `full-g3f82b248-d946fe5d-20260930T2128Z` in its documented location; read existing manifest + original verifier evidence and record exact generation, sealed UTC timestamp, SHA-256, file size and whether it is still safely readable.
- Historical SQLite online backup `g_0fdff06ed014462b158312932fbe967e3b06bdce06c18bd3` may be considered only as **separate historical evidence**, not silently substituted for the export in the Plan.
- Use existing read-only commands or existing verification tools only if they truly have no production side effects; show commands/results. Do not invoke `catalog:snapshot` on production: it takes the publication lock and needs separate owner authorization. No raw catalog/credential dump.
- If the retained snapshot is missing, report `OD-2 BLOCKED` and choices, but do not generate a new one.

## Read-only EB3 feasibility
- Without changing source or DB, identify the selected 24 preview question IDs from `PILOT_24_PREVIEW_SELECTION.csv`. Verify all placeholders against real identifiable products in the **same** retained snapshot using existing, safe catalog reads. For G05 use a real proven contradictory description; for G06 a historical price from same generation. If absent, report unresolved and propose substitute wording with documented evidence; never invent source values.
- Produce a mapping table in the report (question ID → canonical product IDs, names, category, language, generation ID, `snapshot_as_of`, evidence location, status verified/unresolved). **List all unbound question IDs separately** at the top of the report, with the precise missing fact and suggested replacement only when supported by existing snapshot evidence. Do not copy provider-native IDs or `provenance` into model inputs; do not output or log customer data.
- Count products/language/description coverage per proposed subcategory and calculate **actual projection bytes** only from permitted available snapshot/projection tools. If projection does not yet exist and stock read-only tooling cannot calculate it, mark `NOT MEASURED` (do not pretend assumptions are measurements). Do not add new code/index/SQL integration for this step.
- R2 may need separate subcategory corpora (prams, seats, cots). Measure available per-category byte size; report *token estimates* explicitly as estimates unless an already present actual-model token counter provides a measurement. Estimate cold/hit cache cost separately for Haiku/Sonnet/Opus; include Haiku long-context >100k tier without guessing actual usage.

## Read-only EB4-readiness — test n8n ONLY
- Examine the isolated test n8n 2.43.7 container `bp-n8n-poc` without mutations. Check immutable image digest, runtime/db type, RAM/container limits, Data Tables configured size cap and used headroom, file-access restrictions, community-node settings, execution retention and network egress to production/Chatwoot/DBHub. Do not print environment secret values, credentials, or entire `docker inspect` secrets; emit only sanitized allowlisted configuration attributes and PASS/UNKNOWN/BLOCKED evidence.
- Read-only inspect actual saved Anthropic node `typeVersion` on existing inactive workflows; distinguish legacy 1.3/Haiku 4.5 from a *future* 1.6 configuration, not assert a post-GO export exists. Read-only verify n8n 2.43.7 source for availability of node 1.6, Adaptive `medium`, Loop Over Items 1, Agent maxIterations 10, and intermediateSteps; these are not proof of a successful live API call.
- Verify test container n8n remains manual/inactive. Do not change or test any node, workflow, API credential or permission.

## Output/report and STOP
Provide exact source paths, checked hashes/times, command and exit code, and status PASS/UNKNOWN/BLOCKED for EB2, EB3, EB4-readiness and all 24 placeholders. Explicitly distinguish read-only source proof, estimates, and future post-GO smoke test proof. No secrets. If any read itself might mutate production or expose PII, stop and report. No GitHub PR, comment, issue, branch or deployment writes without a separate authorization.
