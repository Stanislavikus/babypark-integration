# Policy Catalog

Status: AGREED ARCHITECTURE / NOT YET EXECUTABLE
Last verified: 2026-09-27

This file lists the durable BabyPark anomaly policies agreed before implementation.
Future machine-readable policy files must preserve these semantics unless a reviewed
architecture change updates this catalog.

## P-01 — Ambiguous identity

Condition:
two or more records share an identifier, but the system cannot prove whether they
represent the same physical product/variant.

Behavior:
- do not guess;
- do not choose by lower price;
- quarantine only the affected entity/listing where safe;
- allow unrelated catalog processing to continue;
- create or update one deduplicated anomaly incident;
- customer-facing AI must not silently choose one result;
- when needed, hand off to a seller with links/context for all conflicting records;
- notify the responsible content/data role according to notification policy.

Permanent resolution requires administrator approval.

## P-02 — Confirmed same product, multiple supplier offers

Condition:
identity has already been confirmed by reviewed evidence as the same physical
product/variant, while commercial supply comes from multiple suppliers/offers.

Behavior:
- one canonical product/variant;
- preserve distinct supplier offers;
- customer-facing selection may choose the lowest trusted current customer price
  among offers that are currently available;
- supplier identity must not create duplicate customer-facing products by itself.

This policy may never be used as evidence that two records are the same product.

## P-03 — Source correction / disappearance

If an anomaly stops appearing after a source correction:
- do not delete history;
- mark it NOT_OBSERVED after the first clean observation;
- after a configurable number of consecutive clean authoritative snapshots,
  transition to AUTO_CLEARED;
- default design target for batch catalog sync: 2 consecutive clean snapshots;
- if the same fingerprint reappears, REOPEN the same incident and increment
  recurrence_count.

AUTO_CLEARED is not equivalent to an administrator-approved identity rule.

## P-04 — Notification deduplication

One stable conflict fingerprint maps to one incident.

Track at minimum:
- first_seen_at;
- last_seen_at;
- occurrence_count;
- consecutive_occurrence_count;
- clean_observation_count;
- recurrence_count;
- last_notified_at;
- last_material_change_at;
- current status/severity.

Do not notify on every sync or every customer query.

Notify/escalate on:
- first observation;
- material evidence/state change;
- recurrence after clear/resolution;
- configurable frequency/severity threshold;
- SLA breach.

## P-05 — Human authority

Content/operator:
- receives notification;
- acknowledges;
- investigates;
- adds evidence/comments;
- fixes source data;
- may propose a resolution.

Administrator/reviewer:
- approves canonical same/different-product resolution;
- approves known exceptions;
- approves permanent mapping/rule;
- approves promotion of a repeated incident pattern into global policy.

AI must consume only approved structured resolution state/policy, never an
unapproved operator comment as authority.

## P-06 — Scoped failure

Unknown anomaly must not automatically stop the whole catalog.

Default:
- isolate/quarantine the smallest unsafe entity scope;
- continue processing unaffected entities.

Whole-run blocking is reserved for system-wide safety/integrity failures such as:
- corrupt identity state;
- broken snapshot consistency;
- unsupported schema/contract;
- publication fencing/recovery failure;
- any condition where safe entity isolation cannot be proven.

## P-07 — Unknown anomaly

A new anomaly class that has no rule:
- gets a stable type/fingerprint when possible;
- is recorded without log spam;
- affected entity is quarantined or handed off safely;
- appears in Data Quality / Requires attention;
- is reviewed later in aggregate;
- may become a new rule only after administrator review.

The system must be extensible without requiring every future source anomaly to be
predicted in advance.

## P-08 — Conversation handoff

When a customer query hits AMBIGUOUS identity:
- do not invent a winner;
- create/update the anomaly incident;
- hand off to seller when product selection cannot be answered safely;
- include conflicting product links/IDs and concise evidence in an internal note;
- do not expose internal anomaly diagnostics to the customer unless deliberately
  designed for that channel.

Seller handling of one conversation does not create a global identity resolution.

## P-09 — Frequency-driven administration

The anomaly UI should support prioritization by:
- severity;
- occurrence_count;
- recurrence_count;
- age;
- number of affected products;
- customer-conversation encounters;
- blocked publication/customer impact.

Frequent unresolved anomalies should rise in priority without generating duplicate
incident rows or unbounded logs.

## P-10 — Auditability

Every administrator-approved resolution/rule must record:
- who approved it;
- when;
- evidence;
- affected identifiers/entities;
- resolution type;
- resulting policy/mapping version;
- rollback/reopen path.

Never silently learn global behavior from one content-manager click.
