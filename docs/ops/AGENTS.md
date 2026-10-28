# AGENTS — discovery entrypoint for any authorized assistant

Status: RUNBOOK / NON-NORMATIVE. Applies to: BabyPark production integration documentation. Supersedes: none. Checked 2026-10-28.

**First read README.md and INDEX.yaml.** Locate customizations by integration ID, not by assuming everything lives inside Chatwoot. **Callback** is at integrations/callback, **Launcher** at integrations/launcher. There is NO Chatwoot core fork.

Trust order: authenticate canonical Stanislavikus/babypark-integration → list docs/ fresh → read current-main docs/AI_WORKING_AGREEMENT.md → identify current deployment/host/versions/hash → inspect relevant runbook and original evidence → begin with read-only verification. Do not import babypark-b2b.

**Safety:** a runbook does not authorize live POST, external sends, restarting services, deleting/clearing logs, queue/DB operations, changing automations, editing secrets or merging Git. Use fictional data only for approved synthetic tests. Unknown recipient, identity, ACK status, CORS, privacy/retention or version semantics ⇒ STOP/HUMAN, not “try a fix”.

Callback shortest path:
- integrations/callback/README.md — current business behavior.
- integrations/callback/REFERENCE.md — exact phone/JWT/POST/label behavior.
- integrations/callback/TROUBLESHOOTING.md — symptom decision tree.
- integrations/callback/UPGRADE_RUNBOOK.md — Chatwoot version comparison and test matrix.
- integrations/callback/RELEASES.md — hashes/recoverable assets and owner release basis.
- integrations/launcher/README.md — Drupal implementation separate from Chatwoot.

Do not take old staging comments as currently deployed truth. Current identity and first-party provider state must be re-read for every new change. Host package can be staged as a non-runtime DRAFT; once approved it will be read-only versioned copy of canonical Git.
