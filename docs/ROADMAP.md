# DriveGit Implementation Roadmap

The target is a reliable small CLI, not a large command surface. Build the local object model first, then remote transport, then recovery and advanced features.

## Milestone 0 — Product and format decisions

**Deliverables**
- Confirm name/license and contribution rules.
- Decide Node.js + TypeScript, package manager, runtimes and supported OSes.
- Define canonical blob/tree/commit serialization and format version.
- Define path, symlink, executable-bit, permission, filename-collision, ignore and max-file-size policies.
- Choose Drive remote namespace and OAuth scope.
- Write threat model and failure-mode table.

**Acceptance**
- Format doc includes deterministic examples/test vectors.
- Behavior for files outside root, symlinks, permission errors and unsupported file types is explicit.
- No claim of unlimited history, merge support or native Git compatibility before verified.

## Milestone 1 — CLI scaffold and local repository

**Deliverables**
- Package scripts, strict TypeScript, lint/format, tests and CI.
- CLI entrypoint, help/version, typed errors and JSON output.
- `init`, repository discovery, config read/write and local lock.
- Versioned `.drivegit` layout and config migrations.
- Documented `.drivegitignore` syntax.

**Acceptance**
- Init works in temporary folders on each supported OS.
- Nested invocations discover the root safely.
- Re-initialization fails helpfully without damage.
- Corrupt config yields recoverable diagnostics.
- Metadata never gets scanned as user content.

## Milestone 2 — Hashes, objects, staging and commits

**Deliverables**
- Streaming SHA-256 blobs.
- Canonical tree/commit serialization.
- Atomic object writes, staged index, branches, HEAD and reflog.
- `add`, `reset`, `status`, `commit`, `log`, `show`.
- Text/binary detection and diff summary.

**Acceptance**
- Re-staging unchanged bytes does not duplicate blob objects.
- IDs are deterministic across repeated runs and OSes for identical canonical content.
- Commit failure never advances a ref.
- Add/delete/rename/empty-dir behavior is tested and documented.
- Corruption detection works.
- Cover Unicode names, spaces, large streams, ignore rules and inaccessible paths.

## Milestone 3 — Safe restore and branch basics

**Deliverables**
- Tree comparison and change classification.
- `restore`, `branch`, `switch`, `tag`.
- Transaction plans, overwrite checks, temp files and recovery journal.
- Local `fsck`, `doctor`, local `gc --dry-run`.

**Acceptance**
- Restore reproduces supported file bytes/metadata.
- Dirty and untracked files are never overwritten by default.
- Fault injection halfway through restore leaves a recoverable state.
- Branch switching refuses unsafe changes by default.
- GC retains every object reachable from HEAD, branches, tags and active operations.

## Milestone 4 — Google sign-in and remote discovery

**Deliverables**
- Browser-based Google OAuth installed-app flow.
- Secure credential storage and logout.
- Remote creation/selection and stable root-folder ID.
- Drive adapter for list/read/create/upload, pagination, retries and error mapping.
- `login`, `logout`, `remote add/list`, `remote verify` groundwork.

**Acceptance**
- Tokens never occur in logs, project files or CI artifacts.
- Remote remains discoverable after folder rename.
- Duplicate Drive filenames do not confuse object lookup.
- Revoked consent, missing permissions, 404, quota errors and intermittent network are handled.
- Only documented OAuth scopes are requested.

## Milestone 5 — Push and fetch

**Deliverables**
- Remote object layout and format checks.
- Reachability walk from commit roots.
- Upload missing blobs/trees/commits with hash verification.
- Immutable operation manifest and safe ref-publication protocol.
- `push --dry-run`, `fetch`, remote-tracking refs and crash recovery.

**Acceptance**
- Repeated push transfers no duplicate verified objects.
- Remote refs cannot point to an incomplete required graph.
- Concurrent push races cannot silently overwrite another head; if consistency cannot be guaranteed by the API protocol, fail closed and document the limit.
- Simulated failures after every push phase leave the prior valid head readable.
- Retry reuses orphaned, verified uploads.

## Milestone 6 — Clone and pull

**Deliverables**
- `clone` into a new empty directory.
- Snapshot fetch and materialization.
- `pull` for safe fast-forward only.
- Dirty-tree checks and divergence diagnostics.
- End-to-end restore tests with a separate test account.

**Acceptance**
- A commit pushed on machine A clones on machine B byte-for-byte.
- Pull refuses to overwrite local edits.
- Diverged histories stop safely; no implicit hard reset.
- Large transfer retries work according to supported Drive API behavior.
- Exported snapshots restore without DriveGit internals.

## Milestone 7 — Hardening and v0.1 release

**Deliverables**
- Complete docs and examples.
- macOS/Linux CI; Windows CI only if supported.
- Security review: OAuth, path traversal, symlinks, file writes and logs.
- Performance baseline and large-file smoke tests.
- Release workflow, changelog, issue templates.
- Publish only after package namespace, provenance and installation steps are verified.

**Acceptance**
- Clean install/build/test from fresh checkout.
- E2E: init, stage, commit, push, clone, verify and restore.
- No unresolved critical/high security issue.
- Drive consistency limits and storage/quota costs are disclosed.
- Recovery works after local metadata loss while remote remains intact.

## Milestone 8 — After v0.1

Prioritize based on evidence:
- merge and conflict resolution;
- binary-aware rename history;
- stash and merge tools;
- encryption with key recovery;
- alternative remotes;
- scheduled snapshots;
- lazy fetching and large repository improvements;
- optional GUI.

Do not implement advanced merge UI before push, clone, integrity checks and restore are proven.

## Continuous quality gates

- Unit tests: canonical serialization, hashing, path normalization, ignore rules, refs and tree comparisons.
- Property/fuzz tests for malformed metadata, path names, corrupt bytes and parser edge cases.
- Integration tests on temporary filesystems.
- Fake remote injects failures, latency, duplicate names, stale refs and ambiguous network outcomes.
- Manual tests against a dedicated Google test account.
- No personal files/credentials in tests.
- Benchmark 100k-file trees and large binary files before optimizations; publish conditions with results.
