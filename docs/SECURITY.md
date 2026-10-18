# DriveGit Security and Privacy

DriveGit can contain private documents, source code, photos and other sensitive files. Security is a core property, not a post-sync enhancement.

## Assets to protect

- Working files and snapshots.
- Local index, refs, object store and recovery journals.
- Google OAuth credentials and refresh tokens.
- Remote object contents and commit metadata.
- Repository identity and integrity of published refs.

## Threats and mitigations

### Credential leakage
- Never commit tokens or client secrets.
- Use the OS credential store where feasible; otherwise use an app-specific config location with restrictive file permissions.
- Redact authorization headers and token values from logs.
- Support logout/revocation and document token deletion.
- Do not place secrets inside a tracked root by default.

### Path traversal and symlinks
- Treat paths from config, ignore rules, remote manifests and command arguments as untrusted.
- Resolve paths and verify that canonical locations remain inside repository root.
- Do not follow symlinks during scans by default.
- During restore, reject absolute paths and parent traversal; validate every component.
- Revalidate before writes/rename to reduce time-of-check/time-of-use risk.
- Refuse suspicious case-colliding paths on case-insensitive filesystems.

### Malicious or corrupt remote
- Validate format version, object schema, sizes, hashes, tree paths and parent relationships before checkout.
- Bound metadata size, nesting depth, entry count and string length.
- Never execute files or project hooks from remote snapshots.
- Treat remote names, messages and manifest content as data, not shell input.
- Bound memory and file descriptors for malformed objects.

### Data loss
- Commit objects are immutable.
- Write objects to temporary locations and atomically promote after validation.
- Update refs only after target graph is durable.
- Preview destructive changes; refuse dirty-tree overwrites by default.
- Journal multi-file restore operations.
- Remote deletion/GC is opt-in, separate, dry-run-first and never an automatic push side effect.

### Remote races and tampering
- Verify each downloaded object against its logical hash.
- Re-read remote heads before ref publication.
- Never silently force-update a remote ref.
- Fail closed if concurrency safety cannot be upheld.
- Hashes prove byte integrity against an ID, not who authored the bytes. Optional signatures can be considered later.

### Privacy and storage
- Tell users what will sync before first push.
- Do not upload ignored files or repository internals as user files.
- Show tracked path list and total size in dry-run.
- Explain that remote folder collaborators may be able to reconstruct tracked content.
- Provide local-only mode.
- No telemetry by default. Future telemetry must be opt-in, documented and scrubbed of content/private paths.

## Encryption

Client-side encryption may be useful but is not a first-milestone feature. Before implementation, define key generation, storage, rotation, backup, revocation, recovery on a new device, metadata encryption, dedupe behavior, and the consequences of lost keys. Never imply encryption protects against malware or an attacker controlling the running local machine.

## Safe defaults

- Do not follow symlinks.
- Ignore `.drivegit/` and credentials.
- No implicit force push or destructive checkout.
- No remote GC during normal push.
- No hooks/scripts run from snapshots.
- No token logging.
- Remote sync requires explicit setup and first-time consent.
- Summarize first upload before transferring files.

## Incident response

If a release leaks credentials or corrupts repositories:
1. Revoke affected OAuth credentials or advise users to revoke consent.
2. Publish a security notice with affected versions and mitigation.
3. Preserve sanitized diagnostics without requesting private file contents.
4. Provide a recovery tool or explicit steps.
5. Add regression tests before shipping the fix.

## Security reporting

Before public release, choose and document a private vulnerability-reporting channel that the maintainer can actually monitor. Do not invent a contact address.
