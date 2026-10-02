# BabyPark AI HUB direction

Status: DEFERRED ARCHITECTURAL DIRECTION
Last verified: 2026-10-02
Owner: BabyPark

## Purpose

BabyPark plans a future AI HUB that gives one controlled operational view across BabyPark systems such as Chatwoot, 1C, Zoho, the SaaS product platform, Catalog/Knowledge and selected infrastructure services.

The HUB is not a new source of business truth and must not become a replacement monolith. It is a control, observability and research plane above existing authorities.

## Core rule

Each connected system keeps its own authority:
- Chatwoot remains conversation transport, operator workspace and transcript authority;
- 1C remains authority for the business data assigned to 1C;
- CatalogService remains product/catalog factual read authority for AI;
- Knowledge Authority remains reviewed operational and commerce-policy authority;
- Zoho remains authority for the Zoho collaboration/mail objects assigned to it;
- the SaaS platform remains authority for its own product-enrichment/workflow state;
- infrastructure runtimes keep their own service/recovery authorities.

The HUB may read, correlate, explain and orchestrate these systems, but must not silently duplicate or override their authoritative state.

## Desired operator experience

A future operator should be able to use one BabyPark surface to:
- inspect health and current state of connected apps;
- research a problem across several systems;
- see incidents, stale integrations, failed jobs and unresolved recovery gates;
- query business facts through the same BabyPark AI brain used by First Line/Seller Assist;
- request an allowed change and see its planned effect before execution;
- execute low-risk approved actions through typed adapters;
- receive provenance for every important answer/action;
- hand off unsupported or sensitive actions to a human workflow.

The design goal is fewer manual dashboards and less memory burden, not centralization for its own sake.

## Safety and write policy

Default integration mode is read-only.

Write actions require all of:
1. a typed adapter/tool owned by BabyPark;
2. explicit authority boundaries and validation;
3. stable actor identity;
4. RBAC/approval appropriate to the target system;
5. idempotency/replay protection where the action can be retried;
6. durable audit/provenance;
7. a fail-closed or compensating recovery path.

The LLM never receives generic shell/database/admin authority merely because the HUB exists.

## Architecture direction

Prefer one BabyPark control plane with small adapters rather than point-to-point AI implementations in every application.

Conceptual flow:

Human or authorized automation
  -> BabyPark AI HUB
  -> policy / identity / decision layer
  -> typed system adapter
  -> Chatwoot | 1C | Zoho | SaaS | Catalog | Knowledge | other approved systems

Shared capabilities should be reused where practical:
- actor identity;
- authorization;
- decision/provenance context;
- health/incident model;
- connector registry;
- audit/event records;
- notification/escalation;
- safe tool execution.

## Infrastructure Registry relationship

The first prerequisite for the HUB is the human-readable Infrastructure Registry in docs/INFRASTRUCTURE_REGISTRY.md.

A later slice may add a machine-readable registry derived from or validated against it. That registry should describe service identity, purpose, endpoints, health checks, authority, dependencies, recovery status and allowed operations without storing secrets.

This would let the HUB answer questions such as:
- what BabyPark services currently exist;
- which service owns a fact;
- what is unhealthy or stale;
- what changed recently;
- where recovery coverage is missing;
- which safe diagnostic/action tool is available.

## Explicit non-goals now

Do not implement the AI HUB during AI First Line Slice B.

Do not:
- migrate data out of Chatwoot/1C/Zoho/SaaS just to feed the HUB;
- build a second Knowledge/Catalog authority;
- give AI unrestricted SSH/RDP/database access;
- introduce a heavy observability platform before concrete needs justify it;
- block current First Line work on HUB UX.

## Revisit trigger

Revisit implementation after enough BabyPark services have stable typed APIs/adapters that one shared control surface measurably removes repeated manual work. Seller Assist and later operational automation are natural consumers, but they remain separate delivery slices.
