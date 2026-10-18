import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ignore from 'ignore';

export type Entry = { hash: string; size: number; mode: number };
export type Tree = Record<string, Entry>;
export type Commit = {
  formatVersion: 1;
  tree: string;
  parents: string[];
  author: { name: string; email: string };
  timestamp: string;
  message: string;
};
export type Repo = { root: string; gitDir: string; config: { formatVersion: number; user: { name: string; email: string } } };
type WorkingEntry = Entry & { absolute: string };
export type StatusResult = {
  branch: string;
  head: string | null;
  staged: Array<{ path: string; kind: string }>;
  unstaged: Array<{ path: string; kind: string }>;
  untracked: string[];
};
export type CommitSummary = { id: string; commit: Commit };

const FORMAT_VERSION = 1;

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function sortedTree(tree: Tree): Tree {
  const result: Tree = {};
  for (const key of Object.keys(tree).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    const entry = tree[key];
    if (entry) result[key] = { hash: entry.hash, size: entry.size, mode: entry.mode };
  }
  return result;
}
function validateTree(raw: Tree): Tree {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid tree object.');
  for (const [relative, entry] of Object.entries(raw)) {
    const segments = relative.split('/');
    if (!relative || relative.startsWith('/') || relative.includes('\\') ||
        segments.some((part) => !part || part === '.' || part === '..') ||
        relative === '.drivegit' || relative.startsWith('.drivegit/')) {
      throw new Error('Unsafe path in tree/index object: ' + relative);
    }
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isSafeInteger(entry.size) ||
        entry.size < 0 || (entry.mode !== 0o100644 && entry.mode !== 0o100755)) {
      throw new Error('Invalid tree entry: ' + relative);
    }
  }
  return sortedTree(raw);
}
function sameEntry(a: Entry | undefined, b: Entry | undefined): boolean {
  return a === undefined ? b === undefined : b !== undefined && a.hash === b.hash && a.mode === b.mode;
}
async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}
async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}
async function atomicWrite(file: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + randomUUID();
  try {
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
function objectPath(repo: Repo, kind: 'blobs' | 'trees' | 'commits', id: string): string {
  return path.join(repo.gitDir, 'objects', kind, id + (kind === 'blobs' ? '' : '.json'));
}
async function storeBlob(repo: Repo, absolute: string): Promise<Entry> {
  const blobDir = path.join(repo.gitDir, 'objects', 'blobs');
  await mkdir(blobDir, { recursive: true });
  const temporary = path.join(blobDir, '.tmp-' + randomUUID());
  const hash = createHash('sha256');
  try {
    const transform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(createReadStream(absolute), transform, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const id = hash.digest('hex');
    const target = objectPath(repo, 'blobs', id);
    if (await exists(target)) await rm(temporary, { force: true });
    else await rename(temporary, target);
    const info = await lstat(absolute);
    return { hash: id, size: info.size, mode: (info.mode & 0o111) !== 0 ? 0o100755 : 0o100644 };
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
async function saveTree(repo: Repo, tree: Tree): Promise<string> {
  const canonical = JSON.stringify(sortedTree(tree));
  const id = digest(canonical);
  const file = objectPath(repo, 'trees', id);
  if (!(await exists(file))) await atomicWrite(file, canonical);
  return id;
}
async function loadTree(repo: Repo, id: string): Promise<Tree> {
  const file = objectPath(repo, 'trees', id);
  if (!(await exists(file))) throw new Error('Missing tree object ' + id);
  const parsed = validateTree(await readJson<Tree>(file));
  if (digest(JSON.stringify(parsed)) !== id) throw new Error('Tree integrity check failed: ' + id);
  return parsed;
}
async function saveCommit(repo: Repo, commit: Commit): Promise<string> {
  const canonical = JSON.stringify(commit);
  const id = digest(canonical);
  const file = objectPath(repo, 'commits', id);
  if (!(await exists(file))) await atomicWrite(file, canonical);
  return id;
}
async function loadCommit(repo: Repo, id: string): Promise<Commit> {
  const file = objectPath(repo, 'commits', id);
  if (!(await exists(file))) throw new Error('Unknown commit ' + id);
  const commit = await readJson<Commit>(file);
  if (digest(JSON.stringify(commit)) !== id) throw new Error('Commit integrity check failed: ' + id);
  if (commit.formatVersion !== FORMAT_VERSION) throw new Error('Unsupported commit format: ' + commit.formatVersion);
  return commit;
}
async function readConfig(gitDir: string): Promise<Repo['config']> {
  const config = await readJson<Repo['config']>(path.join(gitDir, 'config.json'));
  if (!config || config.formatVersion !== FORMAT_VERSION) throw new Error('Unsupported repository format: ' + config?.formatVersion);
  if (!config.user || typeof config.user.name !== 'string' || !config.user.name.trim() ||
      typeof config.user.email !== 'string' || !config.user.email.trim()) {
    throw new Error('Invalid repository config: user.name and user.email must be set.');
  }
  return config;
}
export async function findRepository(startPath = process.cwd()): Promise<Repo> {
  let current = path.resolve(startPath);
  try { if ((await lstat(current)).isFile()) current = path.dirname(current); } catch { /* preserve path for useful error */ }
  while (true) {
    const gitDir = path.join(current, '.drivegit');
    if (await exists(path.join(gitDir, 'config.json'))) return { root: current, gitDir, config: await readConfig(gitDir) };
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Not inside a DriveGit repository. Run "drivegit init" first.');
}
export async function initRepository(rootPath = process.cwd(), branch = 'main'): Promise<string> {
  const root = path.resolve(rootPath);
  const gitDir = path.join(root, '.drivegit');
  if (await exists(gitDir)) throw new Error('A .drivegit directory already exists here.');
  if (!/^[A-Za-z0-9._-]+$/.test(branch) || branch === '.' || branch === '..' || branch.includes('..')) {
    throw new Error('Invalid branch name: ' + branch);
  }
  await mkdir(root, { recursive: true });
  await mkdir(path.join(gitDir, 'objects', 'blobs'), { recursive: true });
  await mkdir(path.join(gitDir, 'objects', 'trees'), { recursive: true });
  await mkdir(path.join(gitDir, 'objects', 'commits'), { recursive: true });
  await mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true });
  const username = process.env.USER || process.env.USERNAME || os.userInfo().username || 'DriveGit User';
  const config = { formatVersion: FORMAT_VERSION, user: { name: username, email: username.toLowerCase().replace(/[^a-z0-9._-]/g, '-') + '@localhost' } };
  await atomicWrite(path.join(gitDir, 'config.json'), JSON.stringify(config, null, 2));
  await atomicWrite(path.join(gitDir, 'HEAD'), 'ref: refs/heads/' + branch + '\n');
  await atomicWrite(path.join(gitDir, 'index.json'), '{}\n');
  await atomicWrite(path.join(gitDir, 'refs', 'heads', branch), '');
  await atomicWrite(path.join(gitDir, '.gitkeep'), '');
  return root;
}
async function headInfo(repo: Repo): Promise<{ branch: string; id: string | null }> {
  const headText = (await readFile(path.join(repo.gitDir, 'HEAD'), 'utf8')).trim();
  if (headText.startsWith('ref: ')) {
    const ref = headText.slice(5);
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    const refFile = path.join(repo.gitDir, ref);
    const id = await readFile(refFile, 'utf8').catch(() => '');
    return { branch, id: id.trim() || null };
  }
  return { branch: '(detached HEAD)', id: headText || null };
}
async function indexTree(repo: Repo): Promise<Tree> {
  const file = path.join(repo.gitDir, 'index.json');
  return validateTree(await readJson<Tree>(file));
}
async function headTree(repo: Repo): Promise<Tree> {
  const head = await headInfo(repo);
  if (!head.id) return {};
  const commit = await loadCommit(repo, head.id);
  return loadTree(repo, commit.tree);
}
function loadIgnore(root: string) {
  const matcher = ignore();
  matcher.add(['.DS_Store', 'Thumbs.db']);
  return readFile(path.join(root, '.drivegitignore'), 'utf8')
    .then((rules) => { matcher.add(rules); return matcher; })
    .catch(() => matcher);
}
async function walkFiles(repo: Repo): Promise<Map<string, WorkingEntry>> {
  const matcher = await loadIgnore(repo.root);
  const found = new Map<string, WorkingEntry>();
  async function walk(directory: string): Promise<void> {
    const items = await readdir(directory, { withFileTypes: true });
    items.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const item of items) {
      if (directory === repo.root && item.name === '.drivegit') continue;
      const absolute = path.join(directory, item.name);
      const relative = path.relative(repo.root, absolute).split(path.sep).join('/');
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        if (!matcher.ignores(relative + '/')) await walk(absolute);
        continue;
      }
      if (!item.isFile() || matcher.ignores(relative)) continue;
      const info = await lstat(absolute);
      found.set(relative, {
        hash: await hashFile(absolute),
        size: info.size,
        mode: (info.mode & 0o111) !== 0 ? 0o100755 : 0o100644,
        absolute
      });
    }
  }
  await walk(repo.root);
  return found;
}
function isWithin(relative: string, target: string): boolean {
  return target === '' || relative === target || relative.startsWith(target + '/');
}
function safeRelative(repo: Repo, input: string): string {
  const absolute = path.resolve(repo.root, input);
  const relative = path.relative(repo.root, absolute);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Path is outside the repository: ' + input);
  }
  const normalized = relative.split(path.sep).join('/');
  if (normalized === '.drivegit' || normalized.startsWith('.drivegit/')) {
    throw new Error('The .drivegit metadata directory cannot be staged or restored.');
  }
  return normalized === '.' ? '' : normalized;
}
export async function stagePaths(startPath: string, inputs: string[], all = false): Promise<{ staged: number; removed: number }> {
  const repo = await findRepository(startPath);
  if (!all && inputs.length === 0) throw new Error('Specify paths or use --all.');
  const index = await indexTree(repo);
  const current = await walkFiles(repo);
  const targets = all || inputs.some((input) => input === '.' || input === './')
    ? ['']
    : inputs.map((input) => safeRelative(repo, input));
  const known = new Set([...Object.keys(index), ...Object.keys(await headTree(repo))]);
  let matchedAny = targets.includes('');
  for (const target of targets) {
    if ([...current.keys()].some((file) => isWithin(file, target)) || [...known].some((file) => isWithin(file, target))) matchedAny = true;
  }
  if (!matchedAny) throw new Error('No trackable files or tracked paths matched. Check the path and .drivegitignore.');
  const next: Tree = all || targets.includes('') ? {} : { ...index };
  for (const [relative, file] of current) {
    if (!targets.some((target) => isWithin(relative, target))) continue;
    const stored = await storeBlob(repo, file.absolute);
    const entry = { hash: stored.hash, size: stored.size, mode: stored.mode };
    next[relative] = entry;
  }
  const trackedPaths = new Set([...Object.keys(index), ...known]);
  for (const relative of trackedPaths) {
    if (!targets.some((target) => isWithin(relative, target))) continue;
    if (!current.has(relative)) delete next[relative];
  }
  const stagedChanges = changedPaths(index, next);
  const staged = stagedChanges.filter((relative) => Boolean(next[relative])).length;
  const removed = stagedChanges.filter((relative) => !next[relative]).length;
  await atomicWrite(path.join(repo.gitDir, 'index.json'), JSON.stringify(sortedTree(next), null, 2) + '\n');
  return { staged, removed };
}
export async function statusRepository(startPath = process.cwd()): Promise<StatusResult> {
  const repo = await findRepository(startPath);
  const head = await headInfo(repo);
  const base = await headTree(repo);
  const index = await indexTree(repo);
  const working = await walkFiles(repo);
  const staged: StatusResult['staged'] = [];
  const unstaged: StatusResult['unstaged'] = [];
  for (const relative of new Set([...Object.keys(base), ...Object.keys(index)])) {
    const before = base[relative];
    const after = index[relative];
    if (!sameEntry(before, after)) staged.push({ path: relative, kind: !before ? 'added' : !after ? 'deleted' : 'modified' });
  }
  for (const relative of new Set([...Object.keys(index), ...Object.keys(working)])) {
    if (!index[relative]) continue;
    const file = working.get(relative);
    const actual = file ? { hash: file.hash, size: file.size, mode: file.mode } : undefined;
    if (!sameEntry(index[relative], actual)) {
      unstaged.push({ path: relative, kind: !actual ? 'deleted' : 'modified' });
    }
  }
  const untracked = [...working.keys()].filter((relative) => !index[relative]).sort();
  staged.sort((a, b) => a.path.localeCompare(b.path));
  unstaged.sort((a, b) => a.path.localeCompare(b.path));
  return { branch: head.branch, head: head.id, staged, unstaged, untracked };
}
function changedPaths(a: Tree, b: Tree): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !sameEntry(a[key], b[key])).sort();
}
export async function createCommit(startPath: string, message: string): Promise<CommitSummary> {
  const repo = await findRepository(startPath);
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Commit message cannot be empty.');
  const index = await indexTree(repo);
  const previous = await headInfo(repo);
  const before = await headTree(repo);
  if (changedPaths(before, index).length === 0) throw new Error('Nothing to commit. Stage changes with drivegit add first.');
  for (const entry of Object.values(index)) {
    const blob = objectPath(repo, 'blobs', entry.hash);
    if (!(await exists(blob)) || (await stat(blob)).size !== entry.size || await hashFile(blob) !== entry.hash) {
      throw new Error('Missing, corrupt, or inconsistent blob: ' + entry.hash);
    }
  }
  const tree = await saveTree(repo, index);
  const commit: Commit = {
    formatVersion: 1,
    tree,
    parents: previous.id ? [previous.id] : [],
    author: { name: repo.config.user.name, email: repo.config.user.email },
    timestamp: new Date().toISOString(),
    message: trimmed
  };
  const id = await saveCommit(repo, commit);
  const headText = (await readFile(path.join(repo.gitDir, 'HEAD'), 'utf8')).trim();
  const ref = headText.startsWith('ref: ') ? path.join(repo.gitDir, headText.slice(5)) : path.join(repo.gitDir, 'HEAD');
  await atomicWrite(ref, id + '\n');
  await atomicWrite(path.join(repo.gitDir, 'index.json'), JSON.stringify(sortedTree(index), null, 2) + '\n');
  return { id, commit };
}
export async function resolveRevision(repo: Repo, revision = 'HEAD'): Promise<{ id: string; commit: Commit }> {
  let current = revision || 'HEAD';
  const ancestorMatch = current.match(/^(.*)~([0-9]+)$/);
  if (ancestorMatch) {
    let resolved = await resolveRevision(repo, ancestorMatch[1] || 'HEAD');
    let steps = Number(ancestorMatch[2]);
    while (steps-- > 0) {
      const parent = resolved.commit.parents[0];
      if (!parent) throw new Error('Revision has no earlier parent: ' + revision);
      resolved = { id: parent, commit: await loadCommit(repo, parent) };
    }
    return resolved;
  }
  if (current === 'HEAD') {
    const head = await headInfo(repo);
    if (!head.id) throw new Error('No commits yet. Create a commit first.');
    current = head.id;
  } else {
    const refFile = path.join(repo.gitDir, 'refs', 'heads', current);
    if (await exists(refFile)) {
      const branchId = (await readFile(refFile, 'utf8')).trim();
      if (!branchId) throw new Error('Branch has no commits yet: ' + current);
      current = branchId;
    }
  }
  if (!/^[a-f0-9]{7,64}$/.test(current)) {
    const names = await readdir(path.join(repo.gitDir, 'objects', 'commits'));
    const matches = names.filter((name) => name.startsWith(current) && name.endsWith('.json'));
    if (matches.length !== 1) throw new Error(matches.length === 0 ? 'Unknown revision: ' + revision : 'Ambiguous revision: ' + revision);
    current = matches[0]!.slice(0, -5);
  }
  return { id: current, commit: await loadCommit(repo, current) };
}
export async function listLog(startPath = process.cwd(), limit = 20): Promise<CommitSummary[]> {
  const repo = await findRepository(startPath);
  const head = await headInfo(repo);
  if (!head.id) return [];
  const result: CommitSummary[] = [];
  let current: string | null = head.id;
  const maximum = Math.max(1, Math.min(Math.floor(limit) || 20, 500));
  while (current && result.length < maximum) {
    const commit = await loadCommit(repo, current);
    result.push({ id: current, commit });
    current = commit.parents[0] || null;
  }
  return result;
}
export async function showCommit(startPath: string, revision = 'HEAD'): Promise<{ id: string; commit: Commit; paths: string[] }> {
  const repo = await findRepository(startPath);
  const resolved = await resolveRevision(repo, revision);
  const next = await loadTree(repo, resolved.commit.tree);
  const parent = resolved.commit.parents[0] ? await loadTree(repo, (await loadCommit(repo, resolved.commit.parents[0])).tree) : {};
  return { id: resolved.id, commit: resolved.commit, paths: changedPaths(parent, next) };
}
async function readBlob(repo: Repo, entry: Entry): Promise<Buffer> {
  const file = objectPath(repo, 'blobs', entry.hash);
  const bytes = await readFile(file);
  if (digest(bytes) !== entry.hash) throw new Error('Blob integrity check failed: ' + entry.hash);
  return bytes;
}
function isBinary(bytes: Buffer): boolean {
  return bytes.includes(0);
}
function simpleTextDiff(before: Buffer, after: Buffer): string {
  if (isBinary(before) || isBinary(after) || before.length > 131072 || after.length > 131072) {
    return 'Binary or large file changed (' + before.length + ' -> ' + after.length + ' bytes).\n';
  }
  const oldLines = before.toString('utf8').split(/\r?\n/);
  const newLines = after.toString('utf8').split(/\r?\n/);
  if (oldLines.length * newLines.length > 200000) {
    return 'Text file changed (' + oldLines.length + ' -> ' + newLines.length + ' lines; diff omitted for size).\n';
  }
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const dp: Uint32Array[] = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      const row = dp[i];
      const nextRow = dp[i + 1];
      if (row && nextRow) row[j] = oldLines[i] === newLines[j] ? (nextRow[j + 1] || 0) + 1 : Math.max(nextRow[j] || 0, row[j + 1] || 0);
    }
  }
  const output: string[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      output.push(' ' + oldLines[i]); i++; j++;
    } else if (i < oldLines.length && (j >= newLines.length || (dp[i + 1]?.[j] || 0) >= (dp[i]?.[j + 1] || 0))) {
      output.push('-' + oldLines[i]); i++;
    } else if (j < newLines.length) {
      output.push('+' + newLines[j]); j++;
    }
  }
  return output.join('\n') + '\n';
}
export async function diffRepository(startPath = process.cwd(), staged = false): Promise<string> {
  const repo = await findRepository(startPath);
  const index = await indexTree(repo);
  const base = staged ? await headTree(repo) : index;
  const working = staged ? null : await walkFiles(repo);
  const next: Tree = staged ? index : Object.fromEntries([...working!.entries()].filter(([relative]) => Boolean(index[relative])).map(([relative, entry]) => [relative, { hash: entry.hash, size: entry.size, mode: entry.mode }]));
  const paths = changedPaths(base, next);
  const output: string[] = [];
  for (const relative of paths) {
    output.push('diff -- ' + relative);
    const oldEntry = base[relative];
    const newEntry = next[relative];
    let before: Buffer = Buffer.alloc(0);
    let after: Buffer = Buffer.alloc(0);
    if (oldEntry) before = await readBlob(repo, oldEntry);
    if (newEntry) {
      if (!staged && working?.get(relative)) after = await readFile(working.get(relative)!.absolute);
      else after = await readBlob(repo, newEntry);
    }
    if (!oldEntry) output.push('new file');
    if (!newEntry) output.push('deleted file');
    if (oldEntry && newEntry && oldEntry.mode !== newEntry.mode) output.push('file mode changed');
    output.push(simpleTextDiff(before, after).trimEnd());
  }
  return output.length ? output.join('\n') + '\n' : 'No differences.\n';
}
async function assertNoSymlinkParents(root: string, relative: string): Promise<void> {
  const segments = relative.split('/');
  let current = root;
  for (let index = 0; index < segments.length - 1; index++) {
    current = path.join(current, segments[index]!);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error('Refusing to restore through symlinked directory: ' + current);
    if (!info.isDirectory()) throw new Error('Refusing to restore through a non-directory path: ' + current);
  }
}
export async function restorePaths(startPath: string, revision: string, inputs: string[], force = false): Promise<{ restored: string[]; removed: string[] }> {
  const repo = await findRepository(startPath);
  if (inputs.length === 0) throw new Error('Specify one or more paths to restore.');
  const resolved = await resolveRevision(repo, revision);
  const source = await loadTree(repo, resolved.commit.tree);
  const head = await headTree(repo);
  const working = await walkFiles(repo);
  const targets = inputs.map((input) => safeRelative(repo, input));
  const allPaths = new Set([...Object.keys(source), ...Object.keys(head), ...working.keys()]);
  const selected = [...allPaths].filter((relative) => targets.some((target) => isWithin(relative, target))).sort();
  if (selected.length === 0) throw new Error('No tracked paths matched those restore arguments.');
  for (const relative of selected) {
    if (source[relative]) await assertNoSymlinkParents(repo.root, relative);
    const current = working.get(relative);
    const tracked = head[relative];
    const wanted = source[relative];
    if (!current) continue;
    const dirty = tracked ? current.hash !== tracked.hash || current.mode !== tracked.mode : Boolean(wanted);
    if (dirty && !force) throw new Error('Refusing to overwrite local changes at ' + relative + '. Re-run with --force after reviewing the path.');
  }
  const restored: string[] = [];
  const removed: string[] = [];
  for (const relative of selected) {
    const wanted = source[relative];
    const current = working.get(relative);
    if (wanted) {
      const target = path.resolve(repo.root, relative);
      const check = path.relative(repo.root, target);
      if (check.startsWith('..' + path.sep) || check === '..' || path.isAbsolute(check)) throw new Error('Unsafe target path: ' + relative);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = target + '.drivegit-tmp-' + randomUUID();
      try {
        await copyFile(objectPath(repo, 'blobs', wanted.hash), temporary);
        if (await hashFile(temporary) !== wanted.hash) throw new Error('Stored blob is corrupt: ' + wanted.hash);
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
      if (wanted.mode === 0o100755) {
        const fs = await import('node:fs/promises');
        await fs.chmod(target, wanted.mode === 0o100755 ? 0o755 : 0o644);
      }
      restored.push(relative);
    } else if (head[relative] && current) {
      await unlink(current.absolute);
      removed.push(relative);
    }
  }
  return { restored, removed };
}
export async function verifyRepository(startPath = process.cwd()): Promise<{ commits: number; trees: number; blobs: number }> {
  const repo = await findRepository(startPath);
  const index = await indexTree(repo);
  const head = await headInfo(repo);
  const roots = new Set<string>();
  if (head.id) roots.add(head.id);

  async function collectRefs(directory: string): Promise<void> {
    if (!(await exists(directory))) return;
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) await collectRefs(absolute);
      else if (item.isFile()) {
        const id = (await readFile(absolute, 'utf8')).trim();
        if (!id) continue;
        if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid reference in ' + absolute);
        roots.add(id);
      }
    }
  }
  await collectRefs(path.join(repo.gitDir, 'refs', 'heads'));

  const visitedCommits = new Set<string>();
  const visitedTrees = new Set<string>();
  const visitedBlobs = new Set<string>();
  async function verifyBlob(entry: Entry): Promise<void> {
    if (visitedBlobs.has(entry.hash)) return;
    const file = objectPath(repo, 'blobs', entry.hash);
    if (!(await exists(file))) throw new Error('Missing blob object: ' + entry.hash);
    const info = await stat(file);
    if (info.size !== entry.size || await hashFile(file) !== entry.hash) {
      throw new Error('Blob integrity check failed: ' + entry.hash);
    }
    visitedBlobs.add(entry.hash);
  }

  for (const entry of Object.values(index)) await verifyBlob(entry);
  const pending = [...roots];
  while (pending.length) {
    const id = pending.pop();
    if (!id || visitedCommits.has(id)) continue;
    const commit = await loadCommit(repo, id);
    visitedCommits.add(id);
    if (!/^[a-f0-9]{64}$/.test(commit.tree)) throw new Error('Invalid tree reference in commit ' + id);
    const tree = await loadTree(repo, commit.tree);
    visitedTrees.add(commit.tree);
    for (const entry of Object.values(tree)) await verifyBlob(entry);
    for (const parent of commit.parents) {
      if (!/^[a-f0-9]{64}$/.test(parent)) throw new Error('Invalid parent reference in commit ' + id);
      if (!visitedCommits.has(parent)) pending.push(parent);
    }
  }
  return { commits: visitedCommits.size, trees: visitedTrees.size, blobs: visitedBlobs.size };
}
export async function setRepositoryConfig(startPath: string, key: string, value: string): Promise<void> {
  const repo = await findRepository(startPath);
  if (key !== 'user.name' && key !== 'user.email') throw new Error('Supported config keys: user.name, user.email');
  if (!value.trim()) throw new Error('Config value cannot be empty.');
  if (key === 'user.name') repo.config.user.name = value.trim();
  else repo.config.user.email = value.trim();
  await atomicWrite(path.join(repo.gitDir, 'config.json'), JSON.stringify(repo.config, null, 2) + '\n');
}
