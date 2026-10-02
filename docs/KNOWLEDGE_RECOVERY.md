# Knowledge Authority recovery

Status: recovery profile VERIFIED on synthetic authority; production CURRENT remains gated
Last verified: 2026-10-02
Owner: BabyPark

## Durable SQLite Backup Profile

Knowledge backup uses:
1. Node SQLite consistent backup API;
2. standalone DELETE-journal SQLite normalization;
3. SQLite integrity verification;
4. plaintext SHA-256;
5. AES-256-GCM encryption;
6. encrypted-artifact SHA-256;
7. HMAC-SHA-256 signed canonical manifest using a key derived from the backup key;
8. off-host copy of ciphertext + signed manifest only;
9. scratch restore;
10. Knowledge semantic verification.

The encryption key is never stored in the manifest or artifact. Runtime input is
`BP_KNOWLEDGE_BACKUP_KEY_B64` (exactly 32 bytes after base64 decode) plus
`BP_KNOWLEDGE_BACKUP_KEY_ID`.

## Backup

```bash
BP_KNOWLEDGE_BACKUP_KEY_B64=... \
BP_KNOWLEDGE_BACKUP_KEY_ID=... \
npm run knowledge:backup -- \
  --source=/var/lib/babypark-integration/knowledge.sqlite \
  --artifact=/secure/staging/knowledge.bpenc \
  --manifest=/secure/staging/knowledge.manifest.json \
  --probe-plan=/etc/babypark/knowledge-recovery-probes.json
```

The artifact and manifest must then be copied off the integration host. The key
must use a separate secret-management path and must never travel beside the
backup artifact.

## Restore verification

On a separate scratch host:

```bash
BP_KNOWLEDGE_BACKUP_KEY_B64=... \
BP_KNOWLEDGE_BACKUP_KEY_ID=... \
npm run knowledge:restore-verify -- \
  --artifact=/offhost/knowledge.bpenc \
  --manifest=/offhost/knowledge.manifest.json \
  --scratch=/scratch/restored-knowledge.sqlite \
  --key-id=...
```

Restore verification fails closed on:
- signed-manifest HMAC mismatch;
- encrypted artifact checksum/size mismatch;
- AES-GCM authentication failure;
- plaintext checksum/size mismatch;
- SQLite integrity or schema-version mismatch;
- revision/event hash or state-machine failure;
- Commerce exception-graph failure;
- authority snapshot mismatch;
- operational or Commerce resolver probe mismatch.

## Semantic evidence

Each backup embeds signed semantic evidence:
- revision/event counts;
- global event-head hash;
- hash of the verified authority snapshot;
- frozen operational probe inputs/results;
- frozen CommercePolicy probe inputs/results;
- evidence SHA-256.

Scratch restore recomputes the evidence from the restored SQLite file and requires
canonical byte equality with the signed evidence.

## Real off-host drill — 2026-10-02

A real drill was executed on exact repository commit
`6f3caf07b5db380337f0c3aa033530a6011a586f`.

Source host role: `chatwoot-fra1-01`.
Independent off-host target: `server2181.babypark.ua`.

Only the AES-GCM ciphertext and HMAC-signed manifest crossed hosts. The fixture
contained synthetic OperationalFact and CommercePolicy authority only, with no
customer data.

Result:
- encrypted artifact: 40,960 bytes;
- artifact SHA-256:
  `bb7fa5f67d0e5ab1dc3f8d74800acb22b03062f5772ee066f3a5cf088a4722d7`;
- restored plaintext SHA-256:
  `7cf330b2a303e46b5fdc405a45db13cc8794bae7a9924db9233c6bd277d1e92b`;
- SQLite integrity: PASS;
- ledger: 3 revisions / 8 events;
- restored event-head hash:
  `1c12ce84cbe27713ff39be941e4d23147cebafb1a34768d43e280534f9c42036`;
- semantic evidence SHA-256:
  `4a362270385f705a9f26de564571aff7cceac7d2e46460dfeaae2128c854cbb7`;
- 2 operational resolver probes: PASS;
- 1 CommercePolicy resolver probe: PASS.

Machine-readable evidence:
`docs/KNOWLEDGE_RECOVERY_DRILL_20261002.json`.

## Production CURRENT gate

The synthetic drill above originally proved only the recovery mechanism and did
not by itself authorize production Knowledge CURRENT.

That gate was subsequently satisfied on 2026-10-02 after canonical physical-store
cutover and production Knowledge deployment. The production-authority proof is
recorded below; storage policy can therefore mark Knowledge CURRENT with encrypted
off-host recovery verified.

## Production authority restore proof — 2026-10-02

After canonical-store production cutover, the real production Knowledge authority was created at /var/lib/babypark-integration/knowledge.sqlite and passed the same encrypted off-host recovery gate.

Off-host target: server2181.babypark.ua
Off-host path: /var/backups/babypark-knowledge/20261002

Proof:
- encrypted artifact SHA-256: 72ce2db14c2b14afb84b93fc0e8a5fc6f1f7db1a840fd2eb6237194824b9ec62;
- restored plaintext SHA-256: c74864a4cc12744d6572724ab1f4a43b76ad2b52d33bd4dfa1eb24800ed55f7e;
- semantic evidence SHA-256: 94344d926936e457997ca587ad2d6afbc827fb85c7fcb99b9e9d2252008dac80;
- SQLite integrity: ok;
- scratch restore: PASS.

The production database was intentionally empty at bootstrap (0 revisions / 0 events), so semantic recovery correctly verifies the empty authority snapshot and ledger rather than relying on synthetic business facts.

This proof supersedes the previous REQUIRED_BEFORE_DEPLOY status for knowledge_db. Production storage policy may mark Knowledge CURRENT with encrypted off-host recovery verified.
