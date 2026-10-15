#!/usr/bin/env python3
"""V12 adversarial cross-reference on full HEAD corpus (post V05 materialization)."""
import json
import re
from pathlib import Path

ROOT = Path("/tmp/v13-pr136-provenance-20261015T203454Z")
design = (ROOT / "v05/HEAD_docs_AI_FIRST_LINE_DESIGN.md").read_text(encoding="utf-8")
accept = (ROOT / "v05/HEAD_docs_AI_FIRST_LINE_ACCEPTANCE.md").read_text(encoding="utf-8")

findings = []

def add(sev, cls, trace, inv, fix):
    findings.append({"severity": sev, "class": cls, "trace": trace, "invariant": inv, "fix": fix})

# Class 1: Lane A numeric leak in normative DESIGN (full scan)
for m in re.finditer(r"Lane A.{0,200}?(?:\d+\s*ms|busy_timeout|PRAGMA|admission limit|WEBHOOK_TIMEOUT)", design, re.I):
    snippet = m.group().replace("\n", " ")
    if "does not" in snippet or "cannot" in snippet or "no numeric" in snippet.lower():
        continue
    add("BLOCKER", "LANE_A_NUMERIC_LEAK", f"DESIGN offset {m.start()}", "Lane A must not authorize numeric timing", snippet[:180])

# Class 2: Customer activation without native matrix (full DESIGN)
if re.search(r"customer execution.*without.*native", design, re.I):
    add("BLOCKER", "ACTIVATION_BYPASS", "DESIGN", "Customer execution needs native matrix", "grep hit")

# Class 3: Q39a/Q39b alignment - cases 6-8 exist
for n in range(1, 9):
    if f"{n}." not in accept.split("### Q39a")[1].split("### Q39b")[0]:
        add("BLOCKER", "Q39A_NUMBERING", f"Q39a case {n}", "Cases 1-8 distinct", "missing")

# Class 4: ACCEPTANCE Expected must fail Lane A numerics
q39a_block = accept.split("### Q39a", 1)[1].split("### Q39b", 1)[0]
q39a_exp = q39a_block.split("Expected:", 1)[1]
if not re.search(r"\(7\).*FAIL CLOSED|\(2\), \(3\), \(5\), \(7\) FAIL CLOSED", q39a_exp):
    add("BLOCKER", "Q39A_EXPECTED_GAP", "Q39a Expected", "Lane A numeric fail-closed", "missing (7)")

# Class 5: §43 cross-ref from §29.8.2 intact
if "§43" not in design[design.find("### 29.8.2"): design.find("### 29.8.3")]:
    add("BLOCKER", "HUMAN_GATE_DROP", "DESIGN §29.8.2", "§43 HUMAN obligations", "missing §43 in 29.8.2")

# Class 6: Two evidence gates wording
if "Two distinct evidence gates" not in design:
    add("BLOCKER", "EVIDENCE_GATES", "DESIGN §29.8.3", "Two gates separation", "missing")

# Class 7: PR-scope only two files - already V04

# Class 8: HEAD must not retain stale HALTs the code-stage
if "HALTs the code-stage" in design or "HALTs the code-stage" in accept:
    add("BLOCKER", "STALE_CODE_STAGE_HALT", "HEAD corpus", "Lane-scoped HALTs", "stale phrase")

# Class 9: BLK-5/6 only in design lane A - acceptable if inline defined
if "BLK-5" in design and "atomic append-plus-durable-HUMAN" not in design:
    add("SHOULD_FIX", "BLK_LABEL", "DESIGN Lane A", "Inline semantics for BLK labels", "add definition")

# Class 10: generic 'code stage' without customer guard - count and sample
cs = list(re.finditer(r"code[- ]stage", design, re.I))
for m in cs:
    ctx = design[max(0, m.start() - 80) : m.end() + 120].replace("\n", " ")
    if "customer execution" in ctx.lower() or "Lane B" in ctx or "unwired" in ctx.lower():
        continue
    add("NON_BLOCKING", "CODE_STAGE_AMBIGUITY", f"DESIGN @{m.start()}", "Prefer lane-scoped terms", ctx[:200])

out = ROOT / "v12-findings.json"
out.write_text(json.dumps(findings, indent=2) + "\n", encoding="utf-8")
blockers = [f for f in findings if f["severity"] == "BLOCKER"]
print(f"V12 inventory: {len(findings)} classes, blockers={len(blockers)}")
print(out)
if blockers:
    for b in blockers:
        print("BLOCKER", b)
