# Google Drive Remote and Synchronization

## Remote model

A DriveGit remote stores its own immutable objects and references in a Google Drive namespace. Local commits work offline. A remote lets another device fetch and restore the same snapshots.

Example local config:

```json
{
  "name": "origin",
  "provider": "google-drive",
  "rootFolderId": "GOOGLE_DRIVE_FOLDER_ID",
  "layoutVersion": 1
}
```

Never store OAuth tokens in project config.

## Pick a namespace deliberately

### Option A: visible Drive folder (recommended first)

Create a folder such as `DriveGit Repositories/<name>.drivegit` in ordinary My Drive. Users can see its storage, share it intentionally, and locate it in the Drive UI.

```text
<repo>.drivegit/
  FORMAT.json
  objects/blobs/
  objects/trees/
  objects/commits/
  refs/heads/
  refs/tags/
  pushes/
  metadata/
```

Use Drive file IDs and app properties to map logical IDs to Drive files. Do not assume names are unique: Drive permits duplicate names. Query by parent ID and verify the object's metadata/hash. Drive file IDs are locators, not logical object IDs.

### Option B: application data folder

The app-data space is hidden and app-scoped. Evaluate it only if it fits desired sharing, discoverability and OAuth requirements. It is not a natural first choice if users expect to browse, share, or manually copy remote data in Drive's normal UI.

Choose one mode for v0.1. Add configurable modes later if demand warrants.

## Google Drive API requirements

Use the official Drive API v3. Implementation must:
- Request the narrowest viable OAuth scope and explain it.
- Handle browser-based OAuth and refresh tokens safely.
- Persist stable folder ID, not repeatedly resolve a folder by name.
- Add shared-drive support only when implemented and tested.
- Process paginated results.
- Request only needed fields (IDs, names, parents, MIME type, size, checksums if available, app properties, modified time, trashed state).
- Map 404 to “missing or inaccessible” rather than assuming deletion.
- Retry quota/rate-limit/transient failures with exponential backoff and jitter.
- Respect API quotas and show progress.
- Use resumable uploads for large objects where appropriate.
- Verify downloaded bytes against DriveGit's own hash.

Do not rely on native Drive revision history or provider checksums alone as the canonical commit history/integrity mechanism.

## Immutable object upload and push order

Google Drive does not offer a general transaction across many object uploads. Design sync around immutable objects, then publication of a reference.

1. Read remote branch ref and remember its commit ID/version.
2. Verify ancestry: remote head must be an ancestor of the local head for a normal fast-forward push.
3. Enumerate objects reachable from the new commit which are absent remotely.
4. Upload blobs, trees and commits, reusing verified immutable objects.
5. Verify the uploaded objects/manifest.
6. Upload an immutable push manifest with intended ref state and operation ID.
7. Publish new ref only if remote still matches the observed old head.
8. If publication fails or remote moved, leave uploaded objects as unreachable data and report a conflict. Never force the ref.
9. Update local remote-tracking state only after successful publication.

## Consistency and races

A naive “read ref, then upload replacement ref file” can race with another client. Never claim compare-and-swap atomicity unless the actual API semantics support it.

For v0.1:
- Serialize pushes per local repository with a lock.
- Evaluate a remote lease/lock protocol with expiry and unique operation IDs.
- Re-read remote state immediately before publication.
- Use ETag/If-Match conditions only if the specific endpoint supports them; verify behavior with tests rather than assuming.
- Use immutable ref-generation records and define one clear current-head pointer strategy.
- On ambiguous network failure after publication, inspect remote state before retrying.
- If safe multi-client concurrency cannot be guaranteed, fail closed and document that simultaneous pushes are unsupported in the initial release.

An expired lease alone does not prove ownership safely. Recovery must be conservative.

## Fetch

1. Read remote refs and repository format version.
2. Download and validate commit/tree metadata.
3. Verify metadata IDs against canonical bytes.
4. Download missing blobs according to the fetch policy.
5. Update remote-tracking refs only after the fetched graph validates.

## Pull

1. Fetch remote metadata.
2. Stop before touching files if working tree is dirty.
3. If remote head fast-forwards local branch, apply a safe checkout transaction and advance branch.
4. If local is ahead, explain that push is available.
5. If histories diverge, stop safely in v0.1 and explain options. Merge comes after conflict handling is well-tested.

## Crash recovery

Failures between object uploads and ref publication are acceptable if:
- Existing published refs continue pointing at a complete, valid graph.
- Immutable unreachable objects do not alter history.
- A retry can reuse verified objects.
- Operation manifests allow identifying interrupted operations.
- `doctor` can list stale temp data and clean only when unreachable and older than a safety grace period.

A local journal should record operation ID, intended ref, expected old head, uploaded object IDs and publication state.

## Renames, deletions and remote GC

Drive files are identified by ID, not name. Logical IDs should determine immutable object identity. Remote cleanup must not be an implicit push side effect.

Remote GC must walk reachability from all heads/tags and active operation manifests, support dry run and grace periods, and protect concurrent pushers. If safe coordination cannot be guaranteed, disable remote GC in the first release.

## Large files and quota

- Hash with streams.
- Show per-object and aggregate progress.
- Use configurable warning thresholds.
- Use resumable uploads where supported and test interrupted transfers.
- Retry transient failures with bounded backoff.
- Keep concurrency quota-aware.
- Explain that snapshots occupy the user's Drive storage quota.
- Deduplication shares identical contents within a repository; it does not provide unlimited/free storage.

## Credentials and sharing

- Never commit OAuth client secrets, access tokens or refresh tokens.
- Prefer a local installed-app OAuth flow appropriate for CLI applications.
- Document every scope and its reason.
- Provide logout/token revocation guidance.
- Never upload outside the repository root via path traversal or symlink following.
- Explain that people with access to the remote folder may be able to reconstruct tracked content.
- Consider client-side encryption only after key recovery and lifecycle design. Encryption affects deduplication and remote inspection.

## API verification checklist

Before shipping, verify against current official docs and a dedicated test account:
- exact OAuth scopes for listing/creating/updating files and folders;
- scope and API behavior for shared drives if supported;
- checksum fields for uploaded binary objects;
- resumable upload behavior;
- conditional ref-update/ETag semantics;
- quota and retry behavior;
- duplicate names, trashed objects and file access errors;
- sharing/storage behavior of the selected namespace.

These are implementation gates; do not guess.
