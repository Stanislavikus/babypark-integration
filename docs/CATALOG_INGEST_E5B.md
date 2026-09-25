# Catalog ingest E5b: publication-lock hardening

E5b hardens the pre-HTTP publication boundary. It adds no endpoint, does not
enable live ingest, and does not add incremental finalization.

## Bounded synchronous acquisition

`CatalogPublicationLock` remains synchronous and same-instance reentrant. Its
default acquisition timeout is 100 ms; callers may configure 0–1000 ms. The
separate initialization timeout defaults to 1000 ms and may be 0–5000 ms.
Initialization uses its timeout only while establishing the marker. Every outer
acquisition resets SQLite `busy_timeout` to the acquisition timeout before
`BEGIN IMMEDIATE`, so request-path acquisition never inherits bootstrap timing.

The canonical directory is resolved before appending
`catalog-publication-lock.sqlite`. A process-local registry fences a second lock
instance for the same canonical path immediately, while nesting through the
same instance remains reentrant. Registry ownership is identity-checked and is
released after failed acquisition, callback failure, commit, or rollback.
Callbacks returning promises remain invalid: the publication lock cannot cross
an `await`.

Only numeric SQLite BUSY/LOCKED from the acquisition's `BEGIN IMMEDIATE` becomes
`PUBLICATION_LOCK_BUSY`. Its stable details identify `same_process` with a zero
timeout or `cross_process` with the configured acquisition timeout. Errors from
protected work retain their original semantics.

## Inode continuity is an operations invariant

The main lock database and its SQLite sidecars are protected storage-policy
objects. Unlinking or replacing the pathname while a holder has the old inode
open can create two independently lockable databases and split the fence.
Neither runtime recovery nor inode diagnostics can repair that condition.
Recreation is allowed only in controlled downtime after every integration and
catalog process is stopped and the absence of holders is established. SQLite,
not a janitor, owns live sidecars. No backup is required because the mutex
database preserves no business state.

## Rollback authority and crash boundary

Rollback ordering is unchanged: mark the target conservatively, record
`rolled_back`, write CURRENT, write PREVIOUS, then reload readers. CURRENT is
more authoritative than publication-journal history. Consequently a current
generation can still provide a valid ACK even when its journal row is already
`rolled_back`.

The RB-C crash window after `CURRENT = g1` but before `PREVIOUS = g2` can
durably leave both pointers at g1. A fresh reader correctly opens g1 and g2-only
evidence is superseded. E5b deliberately performs no automatic PREVIOUS
reconstruction: `rollbackToPrevious()` rejects equal pointers with
`CATALOG_ROLLBACK_INVALID` until an operator reconstructs PREVIOUS under the
generation contract. Reader-reload failure continues to restore the old
pointers and reader while leaving recovery flags and `rolled_back` monotonic.

## E5a concurrency M

When process A pauses while holding the publication mutex, a concurrent process
B now returns bounded `PUBLICATION_LOCK_BUSY`; it does not enter proof, certify,
or publish. B is not left waiting to continue after A dies. A newly started
retry rereads durable evidence, acquires the released fence, and safely reaches
ACKED with one certification and no duplicate publication or generic takeover.
