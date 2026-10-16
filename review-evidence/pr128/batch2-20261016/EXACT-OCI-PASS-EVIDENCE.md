# C6 PR #128 Batch 2 — exact-tree OCI execution evidence
Status: NON-NORMATIVE VERIFICATION EVIDENCE; NOT A HEAVY ZERO-BLOCKER CERTIFICATE.
Applies to: Stanislavikus/babypark-integration only, PR #128, H-LIVE-02a and H-S2-03.
Supersedes: no governance or previous normative contract.
Timestamp: 2026-10-16 UTC.

Pinned HEAD: d4229e900171ce6113970f75201919cc0e217816
Pinned TREE: a36dffc6e46d16cbf4ce2c2ccfa9d57b418129f4
BASE and main: f3d92325e6b4ef04f0137c4c49dde07c05731bbe
Governance blob: e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
Parent (verified clean rebase HEAD): 7d9a0e4c26bb982ed52707fb31f78004e1dc65b6
Code diff of Batch 2: three existing runtime files and one new synthetic test file (27 unit subtests). No runtime dependencies, schema, scheduler, Chatwoot core, deploy or configuration changed.
Owner PRE-CODE GO explicitly approved 2026-10-16T18:51:09Z, Scan v2 SHA256 c9f355192c4e0eae14cf0f3787df09c43b4df123237aa06b1ffb27e845560d64; Fit v2 SHA256 e4c0a129ff1e3c085300c98f4e006d727fe91e547e4492f90c4c98795bd5c0f4.

Exact committed HEAD/TREE and empty status verified before and after each required suite on a freshly materialized Git checkout. Toolchain immutable OCI image sha256:f7dd6300c82e401c82530054cbbb05d883536793e3176de47cdcb453a8c85cd8 (Node 22.23.3), pinned package-lock SHA256 c2bf97d1ffe4161d56b034132d8e194ef08c701710827dfc8ff49b429cc4b3a1. Fresh initially empty install layer npm ci --ignore-scripts --no-audit --no-fund; deps frozen read-only before testing. Each check uses a new network-none, read-only OCI container with separate empty /tmp tmpfs. Source and deps mounted read-only. No real Chatwoot or customer data access.

All results:
- fresh npm ci: EXIT 0; stdout SHA256 a8c1438a45940de47f38874c63ceb785603c78557c83749a183bc33798907fa7
- npm run storage:validate: EXIT 0, stdout SHA256 20a07fabed0c6c0429ac4ee96fb411f30c0a3759a16e4b1b9207bc1974d0e9a1
- npm run test:unit: EXIT 0, 1389/1389, stdout SHA256 c809564a0aeba80aa2451371f4ece24e37cf31b19a00bcc05ecbf8dfd95b672b
- npm run test:legacy: EXIT 0, 13/13, stdout SHA256 80769ef0370c3ce6b6d71a7e7f0b27cf5a833edde213014fb2bb57714c82999c
- npm run test:refactor: EXIT 0, 13/13, stdout SHA256 0ad8ac4f7037b4fc6ea83be5b6aea2c945e4a0c883c7a320bf586a2dad073d9e
- root npm test: EXIT 0, 1389/1389 unit +13/13 legacy +13/13 refactor, stdout SHA256 5e67c4e9d3b40afa3cfbee9a58ceea30f203ece73a6a62a7016ff4883a046758
- git diff --check BASE..HEAD: PASS, 78 deterministic changed paths, Git checkout HEAD/TREE clean at end.
- H-LIVE-02a and H-S2-03 focused synthetic test: 27/27 PASS (covered by exact unit suite).
- A prior unqualified scratch copy with an earlier 28-test variant had diagnostic root npm test 1390/1390; no qualifying claim is made for that uncommitted tree.
- Additional Sonnet independent tests not yet executed on this final HEAD. Thus this is ONE exact-tree positive suite, not independently certified closure.

Known open: H-LIVE-02b bounded unattended PREPARED/GATING crash recovery; Lane B timing/SQLite lock budget and admitted concurrency; real Chatwoot pinned-version native characterization and operator-visible HUMAN delivery; B2 restore and production activation. Unknown/unsupported input remains fail closed. This branch contains only evidence; no merge, deployment or customer-facing AI GO.
