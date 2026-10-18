# DriveGit Architecture

## Goals and constraints

DriveGit tracks a working directory as immutable snapshots. It works offline; the filesystem is the working copy and metadata lives in `.drivegit/`.

Core guarantees:
- A commit references a complete tree snapshot.
- File contents are immutable objects identified by SHA-256.
- A successful commit is durable locally before network work.
- Restore uses temporary-file-and-rename where practical.
- Symlinks and special files follow explicit policy; never follow them outside the repository root.

## Modules

```text
src/
  cli/                    command registration, args, help, exit codes
  core/
    repository.ts         init/open/discover root and config
    scanner.ts            deterministic filesystem walk, ignore evaluation
    index.ts              staged manifest and staging operations
    hash.ts               SHA-256 and integrity checks
    objects.ts             blobs, trees, commits
    refs.ts                branches, tags, HEAD, remote-tracking refs
    diff.ts                tree/working-tree comparisons
    restore.ts             safe restore and checkout transaction plans
    merge.ts               common ancestor and conflict detection (later)
    lock.ts                local locks
  storage/
    local.ts                local objects and refs
    sqlite.ts               cache, scan cache, remote object map
  remotes/
    remote.ts               adapter interface
    google-drive/
      auth.ts               OAuth browser flow and token storage
      client.ts             API requests, retries, pagination
      layout.ts             remote folder and object paths
      push.ts                immutable upload then ref publication
      fetch.ts               read refs and objects
      sync.ts                ancestry checks and conflict handling
  config/defaults.ts
  ui/output.ts              tables, errors, progress rendering
  index.ts
tests/
  unit/
  integration/
  fixtures/
```

The core domain must not depend on Google Drive. A fake remote should be enough to test push/pull.

## Suggested local layout

```text
project/
  .drivegit/
    config.json
    HEAD
    index.json
    db.sqlite
    objects/
      4a/
        4a1f...              # immutable blob or metadata object
    refs/heads/main
    refs/tags/
    refs/remotes/origin/main
    logs/HEAD
    locks/
```

This is illustrative rather than stable format. Include `formatVersion` and migrations before a public release.

- `config.json`: repository ID, format version, remotes, ignore settings.
- `index.json`: staged manifest mapping normalized paths to mode, object ID and size.
- `objects/`: immutable content-addressed objects.
- `refs/`: branch/tag pointers to commit IDs.
- `db.sqlite`: disposable optimization cache for file fingerprints, Drive IDs and operation state. Do not make this the only source of truth for committed history.

## Object model

### Blob

A blob contains raw file bytes. Logical ID is `sha256(rawBytes)`, optionally prefixed with algorithm name, e.g. `sha256:<hex>`. Stream bytes while hashing. Verify the digest on read. Write through a temporary file before atomically promoting an object.

### Tree

A tree describes a directory's direct children, sorted deterministically. Each entry contains name, kind (`file`, `directory`, optionally `symlink`), object/subtree ID, mode metadata, and size for files. Hash a canonical serialization with stable key order, UTF-8 and explicit mode/path rules. Do not concatenate paths ambiguously; use canonical JSON or length-prefixed encoding.

### Commit

A commit points to a root tree and includes parent commit IDs, author identity, timestamp, message, format version and optional metadata.

```json
{
  "formatVersion": 1,
  "tree": "sha256:ROOT_TREE_HASH",
  "parents": ["sha256:PARENT_COMMIT_HASH"],
  "author": { "name": "Example User", "email": "user@example.com" },
  "timestamp": "2026-01-01T12:00:00.000Z",
  "message": "Save project proposal"
}
```

Compute commit ID from canonical serialized commit bytes. A metadata-only/empty commit should require a deliberate option.

### Refs

- Local branch: name -> commit ID.
- Remote-tracking branch: `origin/main` -> last fetched remote commit.
- Tag: name -> commit.
- HEAD: symbolic ref or detached commit.

Updates must be atomic locally. Remote refs need concurrency protection to avoid silently replacing another client's newer push.

## Scanning and ignore rules

- Walk deterministically; do not follow symlinks by default.
- Exclude `.drivegit/`, DriveGit's temp files, and documented OS metadata defaults.
- Support a documented gitignore-inspired `.drivegitignore`; full Git pattern compatibility is not a v0.1 requirement.
- Normalize internal paths to `/`; preserve names and detect case collisions on case-insensitive filesystems.
- Never include files outside the root via symlinks or `..`.
- Content hashes are the final authority for equality. Size/mtime are only scan optimizations.
- Offer `status --refresh` to bypass cached fingerprints.
- Stream large files; never load arbitrary file contents entirely into RAM.

## Commit transaction

1. Acquire repository lock.
2. Validate paths and reject path escapes.
3. Scan/hash staged paths and store missing blobs.
4. Build tree objects bottom-up.
5. Persist commit object.
6. Atomically update branch ref and reflog.
7. Align index with committed tree.
8. Release lock and display short ID.

If anything fails before the ref update, leave previous branch unchanged. Unreachable objects can be garbage-collected later. Never advance the branch before the commit object is durable.

## Restore and checkout

Plan before modifying:
- Enumerate files to create, update or delete.
- Detect untracked/unstaged files that would be overwritten.
- Write replacement files to temporary siblings, fsync where practical, then rename.
- Preserve supported metadata.
- Keep a journal or rollback staging area for multi-file operations.
- Never delete unrelated untracked files.
- Make `--force` explicit and print paths before executing.
- Keep committed objects intact when restoring working files.

Checkout/switch should require a clean tree unless the user explicitly preserves/forces changes. Implement stash later.

## Diff

Text files can show unified diffs. Binary files should show byte-size and change summary, not decoded garbage. Support `--stat`. Rename detection may initially use identical blob IDs; it is an optimization, not a correctness dependency.

## Scalability and garbage collection

- Use a bounded worker pool for hashing.
- Cache fingerprints but revalidate suspicious metadata; strict mode can always hash.
- Stream upload/download and retry at object boundaries.
- Paginate every Drive listing, batch where possible, honor quotas and use exponential backoff with jitter.
- Warn on large files. Dedupe identical file bytes within a repository.
- GC must trace from all branches, tags, HEAD, remote-tracking refs, stashes, active pushes and journals. Remote GC is separate, dry-run-first, with a grace period and concurrency safeguards.

## Decisions required before stable v1

1. SHA-256 and canonical metadata serialization test vectors.
2. Local storage format versioning/migrations.
3. Symlink, permission and empty-directory policies.
4. OAuth flow, scope and secure token storage.
5. Remote namespace: visible folder versus app-data storage.
6. Large-file/resumable transfer behavior.
7. Safe remote reference publication under concurrent pushes.
8. Whether merge/branches are in v1 or deferred.
