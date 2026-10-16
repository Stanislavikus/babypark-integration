# PR #136 — reproduce the frozen final-gate bundle candidate (2026-10-16)

This is an immutable **evidence candidate**, not merge permission. Sonnet's final cross-check and the owner's narrow-contract decision remain outstanding.

## Expected identities

- PR #136 campaign HEAD: `262f7a8999d797f4ceceb531004986cfd6667d73`
- TREE: `ffb8953002feaeb5f417a09a832c86f24051afa2`
- BASE: `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`
- GOV blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- Frozen manifest SHA-256: `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`
- Terminal LIVE PR body SHA-256: `b898db55eeeded8bed7767ed0781514e60822b521367e4a9c0cc340b54614dcc` (9413 bytes, 8 DONE rows).
- Terminal trace SHA-256: `2ba56cd785b1633c7354ca180b6ef63cf0b370247a417b9c06ad33d3dab1586a`.
- Certificate SHA-256: `78b082e3e5e805cbd8eab4bd9528537d7568470e71f64758250a3133ba8e3e9a`.
- Final-gate archive SHA-256: `572443b1b8ad15195ad89edf7cbb84878e210f6852027775dbeeb2334cb2564d`, decoded tar.gz exactly 36,149 bytes.

## Portable reconstruction from the committed Base64 carrier

Save the file `PR136-FINAL-GATE-BUNDLE-20261016.tar.gz.base64` from this evidence directory, then:

```bash
base64 -d PR136-FINAL-GATE-BUNDLE-20261016.tar.gz.base64 > PR136-FINAL-GATE-BUNDLE-20261016.tar.gz
printf '%s  %s\n' '572443b1b8ad15195ad89edf7cbb84878e210f6852027775dbeeb2334cb2564d' 'PR136-FINAL-GATE-BUNDLE-20261016.tar.gz' | sha256sum -c -
mkdir -p pr136-verify
tar -xzf PR136-FINAL-GATE-BUNDLE-20261016.tar.gz -C pr136-verify
(cd pr136-verify && sha256sum -c SHA256SUMS)
```

Inside the archive, independently hash `PRE-OWNER-CLOSURE-CERTIFICATE.md` and `PR136-TERMINAL-TRACEABILITY.md`; parse `PR136-LIVE-REST-RESPONSE.json` and compare its `body` UTF-8 SHA-256 to `b898db55…`, plus HEAD/BASE. Confirm all 8 R136 rows are `DONE` and there are zero outstanding `IN PROGRESS`.

The developer host independently downloaded the Base64 carrier from an immutable GitHub commit, decoded it and got **byte-for-byte equality** with the local deterministic tar.gz and exact SHA-256 above. The original source Git-bundle itself is still only on the authorized dev host; its recorded SHA-256 is `81da36ae198f1b415958ba040175c57a60af07da758f74c4cf30d967f5fd1d2e`, and the source repo HEAD/TREE are exact.

## Scope constraints

The older `review-evidence/pr136/v14-pre-owner-20261015/` certificate/bundle is obsolete: it incorrectly has OCI OPEN. **Only** the current `v14-closure-20261016/` candidate and its SHA-256 files represent the fresh terminal evidence. The external R1/V13 reviewer artifacts retain independent immutable identities, cited in `BUNDLE-SCOPE.md`.

No new normative changes, no new production code, no Chatwoot production changes, no owner approval, no automatic merge.
