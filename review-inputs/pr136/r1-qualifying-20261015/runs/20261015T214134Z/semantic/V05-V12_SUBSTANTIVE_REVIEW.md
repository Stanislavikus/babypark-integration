# V05–V12 substantive qualifying R1 review (PR #136 frozen tuple)

- campaign_head: `262f7a8999d797f4ceceb531004986cfd6667d73`
- campaign_base: `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`
- verifier_image_id: `sha256:eb44e0d4af8d2774d04e5f250707e39e00bfa7cfd241317db2c0be6973344558`
- manifest_sha256: `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`

## V05 — full corpus at HEAD and BASE
- **262f7a8999d797f4ceceb531004986cfd6667d73 `docs/AI_FIRST_LINE_DESIGN.md`**: bytes=220171 sha256=`0d1614a741127d4a64190e5ee4bf845f36bb915b7fe172e127cef34adffda4ad` git_blob=`9fbca03b302fba4c575d4c97ad989e81091808d2`
- **262f7a8999d797f4ceceb531004986cfd6667d73 `docs/AI_FIRST_LINE_ACCEPTANCE.md`**: bytes=154852 sha256=`0f0f54136b2e940fcdd08ad8415ca85661503479f31b8c9c658278bd987f811b` git_blob=`14d0cd0cc8c459ed17b16dff2b3882128b4d88ff`
- **0dfb9b0a1cfe23d455fd436ae9abeac626d0d729 `docs/AI_FIRST_LINE_DESIGN.md`**: bytes=215100 sha256=`871a2e4b2edca293b340f314ca5ea103bf73498c8a833daa1d7999b7cbcf81d9` git_blob=`e3aebe803f8daa7fe401bde794f72e9d68c5a383`
- **0dfb9b0a1cfe23d455fd436ae9abeac626d0d729 `docs/AI_FIRST_LINE_ACCEPTANCE.md`**: bytes=152568 sha256=`4f5124c76666537d539cd144dbbba28deb69fa8c3d04050dce4a0ec1edfbc0a1` git_blob=`5c8a3efcf5cb9810f6cae2b4520dfce960080cde`

## V06 — Lane A numeric prohibition (HEAD DESIGN)
- Positive: Lane A described as UNWIRED / non-numeric timing in authoring plane.
- Negative trace: regex scan for numeric `busy_timeout` / ms literals in Lane A context (automated hits logged in v12-findings; blockers=0)

## V07 — normative anchors (HEAD)
- `UNWIRED` (Lane A/B unwired): **PASS**
- `Two distinct evidence gates` (measurement separation): **PASS**
- `## 43. Native HUMAN handoff v1` (§43 HUMAN): **PASS**
- `### Q39a` (Q39a): **PASS**
- `### Q39b` (Q39b): **PASS**

## V08 — stale / out-of-scope reintroduction guard
- Negative: `HALTs the code-stage`, bare `Agreement §8`, `Q39c` must not appear in HEAD corpus.

## V09 — Lane A/B split (§29.8.3)
- Lane A in DESIGN: yes; Lane B: yes

## V10 — Q39a case (7) fail-closed (ACCEPTANCE)
- Q39a(7) FAIL CLOSED present: yes

## V11 — changed surface (BASE..HEAD)
```
M	docs/AI_FIRST_LINE_ACCEPTANCE.md
M	docs/AI_FIRST_LINE_DESIGN.md
```
- Expected exactly two modified docs: **PASS**

## V12 — R136 traceability rows (contract traces)
- **R136-01** [PASS]: DESIGN Lane A + Q39a
- **R136-02** [PASS]: BLK-5/6 semantics in DESIGN §29.8.3
- **R136-03** [PASS]: Q39a(7) negative gate
- **R136-04** [PASS]: Lane B provenance (i)–(v)
- **R136-05** [PASS]: measurement vs authoring split
- **R136-06** [PASS]: activation barrier
- **R136-07** [PASS]: Agreement scan gate
- **R136-08** [PASS]: frozen manifest SHA-256 in bundle

## Tuple / manifest immutability
- Frozen manifest on disk matches bundle: **PASS**
- Campaign HEAD/TREE/BASE are not mutated by this semantic pass (read-only clone).

## Auxiliary automated phrase inventory
- v12-findings.json entries: 0 (BLOCKER=0); empty blocker list alone is insufficient — this document is the exhaustive substantive record.
