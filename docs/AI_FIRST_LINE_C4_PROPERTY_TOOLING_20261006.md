# BabyPark AI First Line — C4 Property/State-Space Test Tooling Scan

Status: EVIDENCE — NON-NORMATIVE
Applies to: PR #107 C4 production runtime campaign verification tooling only.
Supersedes: none.
Scan time (UTC): 2026-10-06T17:18:00Z
Pinned campaign base: f60c42ca929c55b4bd4c06da5da7558bead5b486
Bound production-options scan SHA-256: 3b2f4445d2412a20546ac31a1ad98f30b4d2d25a0fd50f368b4f8790a95035c2
Recommendation: INTEGRATE fast-check as test-only dev dependency.

## 1. Bounded need

AI_WORKING_AGREEMENT §7.0 requires property/state-space coverage for HEAVY
combinatorial/stateful behavior and requires maintained OSS test tooling to be
selected under §§1-3 before inventing a custom property-testing framework.

PR #107 must make RC1-RC19, C60..C60ad, T01-T06 and U01-U07 mandatory
verification. The tooling must:
- work with the existing Node.js ESM + node:test repository;
- generate/shrink structured cases deterministically when bound to an explicit seed;
- require no production runtime service/database;
- persist no customer/transcript content;
- be free for commercial repository use;
- remain test-only and not become part of customer-facing runtime.

## 2. Candidates

### fast-check
Repository: dubzzz/fast-check
Evaluated main SHA: 2e0da24c9d13e3c7b9de778f1dfebb1a687cbb3c
Package: fast-check 4.10.2
Package blob: 85265c1949b8ddcf794f4d7280a2f06a5ed7aaa7
License: MIT
Node requirement: >=12.17.0
Maintenance: active; evaluated commit 2026-10-06.

Fit:
- PASS Node/ESM compatibility;
- PASS arbitrary generation + shrinking;
- PASS deterministic seeded runs;
- PASS test-only/local execution;
- PASS commercial/free requirement;
- PASS no transcript/runtime persistence requirement.

### testcheck-js
Repository: leebyron/testcheck-js
Evaluated SHA: c7dce0773142546e1b4e208c13b87e7f8f9be253
Maintenance result: FAIL — evaluated source head commit dates to 2018.

### jsverify
Repository: jsverify/jsverify
Evaluated SHA: 60e87e8848537371d34e17874f15fe2902747778
License: MIT
Maintenance result: FAIL — last source update 2021.

## 3. Architecture fit note

Exact bounded use:
- test-only property/state-space generation and shrinking for C4/CATEGORY tests;
- no production import from src/**;
- no runtime service and no external network requirement.

BabyPark-owned boundaries remain:
- all RC1-RC19 semantics;
- C60/T/U expected outcomes;
- C2/C3/Catalog/Knowledge adapters;
- state-store/CATEGORY transaction semantics;
- DecisionBasis and decision kernel;
- test model/oracles.

Data/connectivity:
- synthetic generated values only;
- no Chatwoot connection;
- no production credentials;
- no customer transcripts/PII;
- no production write capability.

Durability/privacy:
- no durable test state is required;
- failing generated cases may be reported as synthetic values only;
- no raw customer content enters the generator.

Concurrency/restart/recovery:
- fast-check owns none of these; it only generates test inputs.
- repository tests continue to exercise BabyPark SQLite/restart/CAS behavior.

Failure isolation/rollback:
- devDependency only;
- removal is package.json/package-lock removal plus replacing generators;
- production runtime remains unchanged.

Custom code still required:
- domain-specific arbitraries/model builders;
- exact expected-outcome oracle from frozen contract;
- explicit exhaustive boundary vectors.

Why integrate:
- directly satisfies the Agreement requirement to prefer maintained OSS
  property tooling;
- dramatically less code/risk than implementing generic shrinking/generation;
- does not alter production architecture.

## 4. Determinism rule

Gate runs must not rely on unrecorded random defaults.
The maintained C4 property suite must bind explicit seeds/run counts in checked-in
test configuration/code and must always execute the fixed exhaustive boundary
vectors independently of randomized generation.

A discovered counterexample becomes a fixed regression vector before blocker
closure so future runs do not depend on rediscovery by chance.

## 5. Decision

Recommendation: INTEGRATE.

Integrate fast-check as a test-only devDependency after owner approval bound to
this evidence digest. No production C4 code or test-framework integration is
authorized by this document alone.

Any material change to package/version/license/data scope/recommendation or the
bound production-options scan invalidates this fit decision.
