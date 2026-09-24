# Catalog ingest E.1: signed request and replay foundation

Status: code and focused tests; NOT DEPLOYED. There is no catalog HTTP route yet.

## Wire contract

The producer sends the exact body bytes covered by SHA-256. The HMAC input
is a UTF-8 string joined with LF and no trailing LF:

```text
BP1
<METHOD>
<PATH>
<AUD>
<KID>
<TIMESTAMP>
<RUN_ID>
<SEQ>
<FINAL_0_OR_1>
<CONTENT_ENCODING>
<SHA256_HEX_OF_TRANSMITTED_BODY>
```

The signature header is `X-BP-Signature: sha256=<64 lowercase hex>`.
The other required headers are X-BP-Version, X-BP-Aud, X-BP-Kid,
X-BP-Timestamp, X-BP-Run, X-BP-Seq, X-BP-Final and
X-BP-Content-Encoding. Version is 1; time uses Unix seconds.
The receiver verifies against its configured audience and active KID map,
enforces a 300-second window by default, and reports clock delta.
Duplicate or combined signed headers fail closed. Verification accepts
only Buffer body bytes, with a 1 MiB transmitted-body default limit.

Only `identity` encoding is enabled by default. Gzip requires explicit
enablement and an independently bounded decompression step in E.2.
The HTTP receiver must compare any transport Content-Encoding to
X-BP-Content-Encoding, enforce limits while reading, and use the raw
request URL path without rewriting it before verification.

## Replay ledger

A separate, explicitly bootstrapped SQLite database stores a durable
receipt keyed by (KID, run ID, layer, sequence). A receipt also binds
the transmitted body hash, final flag and encoding. Claim outcomes:

- NEW: one worker may begin applying this chunk.
- PENDING: a prior claim has no committed ACK; do not apply it again.
- ACKED: return the stored ACK exactly.
- A different body or semantic flags for the same key: conflict.

The ACK is immutable after commit. The file requires mode 0600,
SQLite FULL synchronization, schema and integrity checks on open.
The provisional upper bound is 20,000 receipts; new claims fail closed
at capacity while existing ACKs remain readable. No age-based pruning
is enabled. The E.2 receiver must resolve a PENDING receipt against
authoritative generation/run state after a crash before it can issue
a final ACK; ledger and catalog publication are not yet atomic.

## Deployment boundary

E.1 only supplies library code and tests. It is absent from the live
release, Nginx and systemd service. No Drupal exporter exists here;
nothing in E.1 connects to or writes the Drupal production database.

Before enabling ingest: finish E.2 staged apply/commit recovery,
E.3 adversarial and storage tests, receipt retention/backup policy,
NTP check and a controlled read-only Drupal exporter validation.
