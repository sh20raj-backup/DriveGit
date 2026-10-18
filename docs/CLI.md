# DriveGit CLI Specification

This is the intended v0.x command contract, not yet a shipped CLI.

## Global behavior

- Executable: `drivegit`.
- `--version`, `--help`, subcommand-specific help.
- Exit codes: 0 success, 1 operation failure, 2 invalid usage, 3 unsafe/conflicting state, 4 auth/remote failure (standardize before v1).
- Human output by default; `--json` for scripts.
- `--quiet`, `--verbose`; verbose logs must redact credentials.
- Respect TTY, `NO_COLOR`, and `--no-color`.
- Commands write outside repository only to documented global config/cache/credentials and explicitly requested paths.
- Destructive operations show previews or require explicit confirmation.

## Init and identity

```sh
drivegit init
drivegit init --branch main
drivegit config user.name "Your Name"
drivegit config user.email "you@example.com"
```

Init creates only local metadata; it must not upload files. Running it twice in the same repository should give a helpful error without modifying anything.

## Ignore, status and staging

```sh
drivegit status
drivegit status --refresh
drivegit status --short
drivegit add README.md assets/ notes/
drivegit add -A
drivegit reset README.md
drivegit diff
drivegit diff --staged
drivegit diff --stat
```

Status categories:
- staged: changes included in next snapshot;
- modified/deleted: tracked working-tree changes not staged;
- untracked: new non-ignored paths;
- ignored: opt-in listing;
- remote: local head ahead/behind/diverged from known tracking ref.

The index represents the next snapshot. A missing working file is not staged for deletion until `add -A` or an explicit remove operation runs.

## Commits and history

```sh
drivegit commit -m "Add field interview notes"
drivegit log
drivegit log --oneline --graph
drivegit show HEAD
drivegit show 8ab12d4
drivegit show --stat HEAD
```

Require an author identity and non-empty message. Failed commit must not advance the current branch ref. Show short commit ID, message, changed-path summary and warnings. Serialize timestamps in UTC; localize only for display.

## Restore and branches

```sh
drivegit restore --source HEAD~1 notes/plan.md
drivegit restore --staged notes/plan.md
drivegit branch
drivegit branch experiment
drivegit switch experiment
drivegit switch --detach 8ab12d4
```

Before switching, detect paths that would be overwritten or removed and refuse by default. `restore --staged` changes index only. `restore --source` changes working files and must use a journal or rollback staging area. Never delete unrelated untracked files. Keep `checkout` out of v0.1 if it makes branch switching and file restore ambiguous.

## Remote setup and auth

```sh
drivegit login
drivegit logout
drivegit remote add origin gdrive:
drivegit remote -v
drivegit remote set-url origin gdrive:
drivegit remote remove origin
drivegit remote init origin --name "DriveGit Project"
```

Use browser authorization and let users explicitly choose/create the Drive folder. Never ask users to paste refresh tokens into a command line. Validate any future arbitrary remote URL support.

## Sync

```sh
drivegit fetch origin
drivegit pull
drivegit push
drivegit push --dry-run
drivegit push --progress
drivegit clone gdrive:<repo-id> ./restored-folder
```

- Push uploads required immutable objects before ref publication.
- Push fails on non-fast-forward or concurrent remote-head changes.
- Never force push implicitly.
- Pull never overwrites a dirty working tree.
- Fetch does not change working files or active local branch.
- On a network error after possible publication, inspect remote state before retrying.
- Errors should describe safe next steps without choosing a risky one automatically.

## Verification and maintenance

```sh
drivegit fsck
drivegit doctor
drivegit gc --dry-run
drivegit gc
drivegit remote verify origin
drivegit export --commit HEAD --output ./snapshot.zip
```

- `fsck`: validate object hashes, trees, commits, refs and reachability.
- `doctor`: check permissions, repository format, auth state (never token contents), remote reachability, config and unfinished operations.
- `gc`: local-only initially, dry-run-first; protect refs and active operations.
- `remote verify`: verify all reachable remote objects against logical IDs.
- `export`: materialize one commit without internal metadata.

## Future commands (not v0.1 commitments)

`stash`, `merge`, `rebase`, `cherry-pick`, `bisect`, file-history/blame, auto-snapshots, lazy download, external object storage, encryption, GUI, and Git repository import. Add them only when behavior is clear for arbitrary binary/mixed-content folders.

## Safety contract

Any command that removes or overwrites working files must state what will change, stop if filesystem state changed after the plan, and avoid deleting files it does not own. Use a transaction journal for multi-file actions. A remote backup must not be considered verified until restoration and integrity checks have succeeded.
