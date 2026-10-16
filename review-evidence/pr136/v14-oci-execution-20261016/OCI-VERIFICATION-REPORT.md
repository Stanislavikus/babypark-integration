# PR136 V14 immutable OCI Git verification (2026-10-16)
Status: four REQUIRED Git executions PASS; PR body / owner approval / merge remain OPEN.
Repository: Stanislavikus/babypark-integration
Device: ubuntu-s-1vcpu-1gb-fra1-01
HEAD: 262f7a8999d797f4ceceb531004986cfd6667d73
TREE: ffb8953002feaeb5f417a09a832c86f24051afa2
BASE: 0dfb9b0a1cfe23d455fd436ae9abeac626d0d729
GOV blob: e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
Manifest SHA256: adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6 (7861-byte exact file verified)
Source git bundle SHA256: 81da36ae198f1b415958ba040175c57a60af07da758f74c4cf30d967f5fd1d2e
OCI image: alpine/git@sha256:16ad8e788e1d3b0c30f18da8dde5c0ace3b187445a62d8af893b003ca1e70592
OCI image ID: sha256:1e9c22afa6ede25f7576eb217c50176f592c624de6b896b9e574458627e02b2b
OCI git: version 2.45.2, /usr/bin/git SHA256 2b0cf7eef70e8ab6cf6766149c87fe00165a1895196f3f3b2937fa51bef14d0c
Runner SHA256: d278f4054bb280c7c57fdbcf508816f43cd1dbd1dcdb12b8dacd5b3991706603

Per-check: independent new clone from source bundle, pinned HEAD+tree+base, blank porcelain/index before and after; --network none, --read-only container, /repo:ro, distinct /out:rw, no prior caches. Exit status and complete stdout/stderr hashed.
V03 git diff --check: exit 0, stdout e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; stderr empty.
V04a git diff --name-status: exit 0, stdout f1493242fb8ed69fbf96c864a81acb4a4e7eedad998b7a37ef0b7437d405b6af; exactly M docs/AI_FIRST_LINE_ACCEPTANCE.md; M docs/AI_FIRST_LINE_DESIGN.md.
V04b git diff --stat: exit 0, stdout 9a9e3f4d640f75087c8ebebacc87f457680c0eb049a78dc2e8f5b22d800755e3.
V04c git diff full patch: exit 0, stdout cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714. This equals V13 previously frozen patch digest. No stderr.
R1/V13 reviewer closure is preserved as historical independent evidence; this report does not perform a new HEAVY review.
No runtime, Chatwoot, PR branch, or live PR body was changed in this run.
This local archive is NEW supporting evidence, not yet a committed GitHub evidence branch or final-gate bundle. Owner-bound certificate/final SHA need regeneration after all remaining gates close.
