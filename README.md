# DriveGit

**Git for every folder. Google Drive as your remote.**

DriveGit is an open-source, local-first CLI that gives ordinary folders Git-style snapshots, commits, history, branches, and remote backup using Google Drive. Version-control code, notes, PDFs, photos, videos, design assets, and mixed folders without requiring a GitHub repository or changing how you work.

> **Status:** Planning / early scaffold. The command examples below describe the intended interface, not a released or working CLI yet.

## Why DriveGit?

Git is excellent for source code, but many everyday files are awkward to version through Git hosting: large assets, PDFs, documents, photos, exported designs, and personal folders. Google Drive stores these files, but its native revision history is not a substitute for a commit graph with durable, user-defined checkpoints and branch-like history.

DriveGit combines:
- A **local-first repository** hidden in a `.drivegit/` directory.
- Human-authored **commits** with parent relationships and full-folder snapshots.
- A **content-addressed object store** that deduplicates identical file bytes.
- A Google Drive remote that stores DriveGit's own objects and refs.
- Explicit push/pull, safe restoration, status, diff, history, branches, and tags.
- Ignore rules, dry runs, progress, resumable transfers, and conflict protection.

DriveGit must not rely on Google Drive automatically retaining every native file revision. DriveGit's history is represented by its own immutable objects and commit metadata.

## Quick vision

```sh
cd ~/Documents/research
drivegit init
drivegit status
drivegit add .
drivegit commit -m "Save initial research notes"
drivegit remote add origin gdrive:
drivegit push -u origin main
```

The exact CLI grammar can evolve as the implementation is validated. The product should keep the common path simple while making destructive operations explicit.

## Core principles

1. **Any folder, any file type.** No file extension is intrinsically required. Use configurable size limits and optional exclusions.
2. **Local-first.** Commits work without a network connection. Google Drive is a remote, not the only copy of the index or commit graph.
3. **No silent data loss.** Push never overwrites an unrelated remote head; checkout/restore never discards local edits without an explicit force option and a clear preview.
4. **Content-addressed storage.** Files with the same content share one stored object. Every object is verified by its hash.
5. **Transparent storage and recovery.** Users can inspect repository metadata, export manifests, and verify remote objects.
6. **Least privilege.** Request the narrowest Google OAuth permissions compatible with the chosen storage model; never print or commit tokens.
7. **Portable and testable.** Start with macOS/Linux; isolate filesystem and Google Drive APIs behind interfaces to support Windows and alternative remotes later.
8. **Incremental by default.** Only changed objects and reference updates are transferred on push.

## User experience

```text
$ drivegit status
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged:
  modified:   notes/semester-plan.md
  added:      screenshots/week-4.png
  deleted:    drafts/old-outline.txt

$ drivegit add notes/semester-plan.md screenshots/week-4.png drafts/old-outline.txt
$ drivegit diff --staged
$ drivegit commit -m "Update semester plan"
[main 8ab12d4] Update semester plan
 3 paths changed

$ drivegit push
Enumerating objects: 4
Uploading: 100% (4/4), 2.1 MiB
Updated origin/main
```

## Planned commands

| Command | Purpose |
|---|---|
| `drivegit init` | Initialize tracking in the current folder |
| `drivegit status` | Show staged, unstaged, ignored, and remote-ahead changes |
| `drivegit add <path...>` | Stage files and directories |
| `drivegit add -A` | Stage additions, modifications, and deletions |
| `drivegit reset <path...>` | Unstage paths; do not discard their working files |
| `drivegit diff` | Show unstaged differences where format permits |
| `drivegit diff --staged` | Show staged changes |
| `drivegit commit -m "message"` | Create a snapshot commit |
| `drivegit log` | Display commit history |
| `drivegit show <commit>` | Inspect a commit and its manifest |
| `drivegit restore --source <commit> <path>` | Restore a path, with overwrite checks |
| `drivegit checkout <commit-or-branch>` | Switch snapshots/branches after safety checks |
| `drivegit branch [name]` | List or create local branches |
| `drivegit switch <branch>` | Switch branches |
| `drivegit merge <branch>` | Merge histories when supported |
| `drivegit tag <name> [commit]` | Name a meaningful snapshot |
| `drivegit remote add origin gdrive:` | Configure a Google Drive remote |
| `drivegit remote -v` | Show remotes |
| `drivegit login` | Authorize Google Drive in a browser |
| `drivegit push` | Upload missing objects and safely advance remote refs |
| `drivegit pull` | Fetch and integrate remote history safely |
| `drivegit fetch` | Download remote commits/refs without changing files |
| `drivegit clone <remote> <dir>` | Download a repository to a new directory |
| `drivegit fsck` | Verify local object graph and checksums |
| `drivegit gc` | Reclaim unreachable local objects after safety checks |
| `drivegit doctor` | Diagnose auth, config, filesystem, and remote issues |
| `drivegit config <key> <value>` | Configure repository/user preferences |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — storage format, object model, modules, filesystem scanning.
- [Google Drive remote and sync](docs/GOOGLE-DRIVE.md) — Drive API layout, OAuth, push/pull, consistency and conflict behavior.
- [CLI specification](docs/CLI.md) — command contract and safety guarantees.
- [Implementation roadmap](docs/ROADMAP.md) — milestones, acceptance criteria, testing, and release plan.
- [Security and privacy](docs/SECURITY.md) — credentials, local data, file handling, threat model.

## Recommended initial stack

Use **TypeScript on Node.js** for the first version:
- CLI: `commander` or `yargs`
- Terminal output: `picocolors` plus a small custom table/progress renderer
- Schema validation: `zod`
- Local metadata: SQLite for index/cache, with portable JSON objects for serialized commit/tree metadata
- Hashing: Node.js `crypto` using SHA-256
- Google auth/API: official Google APIs client, with OAuth handled through a browser flow
- Tests: `vitest`, temporary filesystem fixtures, and a mocked Drive adapter
- Packaging: npm package named `drivegit` if available; provide a standalone binary later

Keep core snapshot logic independent of Google APIs. Treat file contents as immutable blobs, trees as directory manifests, commits as immutable metadata, and branches as refs. Google Drive stores those DriveGit objects; its native revision history is not the canonical commit store.

## Non-goals for the first release

- Real-time multi-user collaboration or live co-editing.
- Transparent binary merging.
- Replacing Google Docs' collaborative editing and comments.
- An immediate promise of unlimited free storage or unlimited history.
- A GUI, web dashboard, mobile application, or server-hosted account system before CLI sync is reliable.
- Compatibility with Git's on-disk repository format in v0.1. DriveGit can adopt Git-like concepts without claiming native Git compatibility.

## Contributing

The project is in planning. Start with the roadmap and use small, testable pull requests. The first implementation milestone should be a purely local repository with deterministic commits and restoration; Google Drive sync comes after the local object model is trustworthy.

## License

Choose and add a license before publishing implementation code. MIT or Apache-2.0 are reasonable options for an OSS CLI; select intentionally before accepting contributions.
