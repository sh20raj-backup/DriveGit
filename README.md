# DriveGit

**Git for every folder. Google Drive as your remote.**

DriveGit is an open-source, local-first CLI for snapshots and version history across ordinary folders: source code, notes, PDFs, images, documents, research data, and mixed assets.

> **Current status: v0.1.0 development.** The local snapshot engine is being implemented. Google Drive push/pull is not implemented yet; do not treat this release as a remote backup.

## First working slice

Node.js 20 or newer is required.

```sh
git clone https://github.com/SH20RAJ/DriveGit.git
cd DriveGit
npm install
npm run build
npm test
npm link
```

Or run without linking:

```sh
npm run dev -- init
npm run dev -- add -A
npm run dev -- commit -m "Initial snapshot"
npm run dev -- log
```

## Example

```sh
cd ~/Documents/research
drivegit init
drivegit add -A
drivegit commit -m "Initial research snapshot"

# Later, after editing files:
drivegit status
drivegit diff
drivegit add notes.md
drivegit commit -m "Update field notes"

# Restore a file from a previous commit:
drivegit log
drivegit restore notes.md --source HEAD~1
```

The restore command only changes working files, not the branch history or staging index. It refuses to overwrite local edits unless `--force` is explicitly supplied. Review the target paths before using `--force`.

## Implemented commands

| Command | Current behavior |
|---|---|
| `init` | Creates `.drivegit/` local metadata and initial branch |
| `status` | Lists staged, unstaged, and untracked files |
| `add <paths...>` | Stages selected files/directories |
| `add -A` | Stages additions, modifications, and deletions |
| `commit -m "message"` | Creates an immutable local snapshot |
| `log` | Lists commit history |
| `show [revision]` | Shows commit metadata and changed paths |
| `diff` | Shows unstaged text changes; binary/large content is summarized |
| `diff --staged` | Compares the index with HEAD |
| `restore <paths...> --source <revision>` | Restores selected working files with overwrite checks |
| `config user.name "Name"` | Sets commit author name |
| `config user.email "you@example.com"` | Sets commit author email |
| `doctor` | Checks local repository metadata |
| `push`, `pull` | Reserved commands; Google Drive sync is not implemented yet |

`.drivegitignore` supports common ignore patterns. Symlinks are skipped by default; empty directories are not versioned. This early release creates complete snapshots locally and is not yet Git on-disk-format compatible.

## How it works

- Blobs store raw file content and use SHA-256 IDs.
- Tree objects record a complete folder snapshot.
- Commits are immutable metadata objects containing a tree, parent IDs, author, timestamp, and message.
- Branch refs are updated only after the commit object is written.
- Identical bytes are deduplicated within a local repository.
- Restore verifies content hashes before replacing paths.

Local object storage is under `.drivegit/objects`. Do not manually edit repository internals. Back up the entire `.drivegit/` directory if you need to preserve local history before remote sync exists.

## Architecture and roadmap

- [Architecture](docs/ARCHITECTURE.md)
- [Google Drive sync design](docs/GOOGLE-DRIVE.md)
- [CLI specification](docs/CLI.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [Security and privacy](docs/SECURITY.md)

## Next milestone

The next engineering milestone is local hardening: validate metadata rigorously, improve crash-safe restore, add integrity verification/garbage collection, and cover unusual paths and large-file edge cases. Then implement OAuth and Google Drive object transport, resumable transfers, safe remote-ref publication, and end-to-end clone/pull tests. DriveGit will not pretend that cloud backup works before those tests pass.

## License

MIT. See [LICENSE](LICENSE).
