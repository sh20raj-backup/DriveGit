import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCommit, diffRepository, initRepository, listLog, restorePaths, stagePaths, statusRepository, verifyRepository } from '../src/core.js';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drivegit-test-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local snapshot engine', () => {
  it('initializes, stages, commits, and reports a clean working tree', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'notes.txt'), 'first version\n');
    await initRepository(root);
    expect((await statusRepository(root)).untracked).toContain('notes.txt');
    await stagePaths(root, [], true);
    const commit = await createCommit(root, 'Initial notes');
    expect(commit.commit.message).toBe('Initial notes');
    expect((await statusRepository(root)).staged).toHaveLength(0);
    expect((await statusRepository(root)).unstaged).toHaveLength(0);
    expect((await statusRepository(root)).untracked).toHaveLength(0);
    expect((await listLog(root))).toHaveLength(1);
  });

  it('keeps a previous version and restores a file from a commit', async () => {
    const root = await fixture();
    await initRepository(root);
    await writeFile(path.join(root, 'draft.txt'), 'version one\n');
    await stagePaths(root, ['draft.txt']);
    const first = await createCommit(root, 'Save version one');
    await writeFile(path.join(root, 'draft.txt'), 'version two\n');
    await stagePaths(root, ['draft.txt']);
    await createCommit(root, 'Save version two');
    const result = await restorePaths(root, first.id, ['draft.txt']);
    expect(result.restored).toContain('draft.txt');
    expect(await readFile(path.join(root, 'draft.txt'), 'utf8')).toBe('version one\n');
    expect((await listLog(root))).toHaveLength(2);
  });

  it('refuses to overwrite dirty working files without --force', async () => {
    const root = await fixture();
    await initRepository(root);
    await writeFile(path.join(root, 'draft.txt'), 'committed\n');
    await stagePaths(root, ['draft.txt']);
    const commit = await createCommit(root, 'Save draft');
    await writeFile(path.join(root, 'draft.txt'), 'local unsaved edits\n');
    await expect(restorePaths(root, commit.id, ['draft.txt'])).rejects.toThrow('Refusing to overwrite local changes');
    await restorePaths(root, commit.id, ['draft.txt'], true);
    expect(await readFile(path.join(root, 'draft.txt'), 'utf8')).toBe('committed\n');
  });

  it('detects staged and unstaged changes separately', async () => {
    const root = await fixture();
    await initRepository(root);
    await writeFile(path.join(root, 'a.txt'), 'one\n');
    await stagePaths(root, ['a.txt']);
    await createCommit(root, 'First');
    await writeFile(path.join(root, 'a.txt'), 'two\n');
    await stagePaths(root, ['a.txt']);
    await writeFile(path.join(root, 'a.txt'), 'three\n');
    const status = await statusRepository(root);
    expect(status.staged.some((item) => item.path === 'a.txt')).toBe(true);
    expect(status.unstaged.some((item) => item.path === 'a.txt')).toBe(true);
    expect(await diffRepository(root)).toContain('+three');
  });

  it('stages tracked deletions with add -A', async () => {
    const root = await fixture();
    await initRepository(root);
    await writeFile(path.join(root, 'remove-me.txt'), 'tracked\\n');
    await stagePaths(root, ['remove-me.txt']);
    await createCommit(root, 'Track file');
    await rm(path.join(root, 'remove-me.txt'));
    const result = await stagePaths(root, [], true);
    expect(result.removed).toBe(1);
    expect((await statusRepository(root)).staged).toEqual([{ path: 'remove-me.txt', kind: 'deleted' }]);
  });

  it('verifies reachable objects and detects corrupted blobs', async () => {
    const root = await fixture();
    await initRepository(root);
    await writeFile(path.join(root, 'notes.txt'), 'integrity matters\\n');
    await stagePaths(root, ['notes.txt']);
    const commit = await createCommit(root, 'Integrity fixture');
    expect(await verifyRepository(root)).toEqual({ commits: 1, trees: 1, blobs: 1 });
    const tree = JSON.parse(await readFile(path.join(root, '.drivegit', 'objects', 'trees', commit.commit.tree + '.json'), 'utf8')) as Record<string, { hash: string }>;
    await writeFile(path.join(root, '.drivegit', 'objects', 'blobs', tree['notes.txt']!.hash), 'tampered');
    await expect(verifyRepository(root)).rejects.toThrow('Blob integrity check failed');
  });

  it('refuses to restore through a symlinked parent directory', async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'drivegit-outside-'));
    roots.push(outside);
    await initRepository(root);
    await mkdir(path.join(root, 'linkdir'), { recursive: true });
    await writeFile(path.join(root, 'linkdir', 'file.txt'), 'inside repository\\n');
    await stagePaths(root, ['linkdir']);
    const commit = await createCommit(root, 'Track nested file');
    await rm(path.join(root, 'linkdir'), { recursive: true, force: true });
    await symlink(outside, path.join(root, 'linkdir'));
    await expect(restorePaths(root, commit.id, ['linkdir'])).rejects.toThrow('symlinked directory');
  });

  it('does not follow symlinks or stage ignored paths', async () => {
    const root = await fixture();
    await initRepository(root);
    await mkdir(path.join(root, 'cache'), { recursive: true });
    await writeFile(path.join(root, '.drivegitignore'), 'cache/\n');
    await writeFile(path.join(root, 'cache', 'ignored.txt'), 'ignored');
    await writeFile(path.join(root, 'target.txt'), 'target');
    await symlink('target.txt', path.join(root, 'alias.txt'));
    await stagePaths(root, [], true);
    const status = await statusRepository(root);
    expect(status.untracked).not.toContain('cache/ignored.txt');
    expect(status.untracked).not.toContain('alias.txt');
  });
});
