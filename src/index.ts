#!/usr/bin/env node
import { Command } from 'commander';
import {
  createCommit,
  diffRepository,
  findRepository,
  initRepository,
  listLog,
  resolveRevision,
  restorePaths,
  setRepositoryConfig,
  showCommit,
  stagePaths,
  statusRepository,
  verifyRepository
} from './core.js';

const program = new Command();
program
  .name('drivegit')
  .description('Git-like local versioning for any folder. Google Drive sync is coming next.')
  .version('0.1.0');

program.command('init')
  .description('Initialize local version history in this folder')
  .option('-b, --branch <name>', 'initial branch name', 'main')
  .action(async (options: { branch: string }) => {
    const root = await initRepository(process.cwd(), options.branch);
    console.log('Initialized empty DriveGit repository in ' + root + '/.drivegit');
    console.log('Next: drivegit add -A && drivegit commit -m "Initial snapshot"');
  });

program.command('status')
  .description('Show staged, unstaged, and untracked changes')
  .action(async () => {
    const result = await statusRepository();
    console.log('On branch ' + result.branch);
    if (!result.head) console.log('No commits yet.');
    const print = (title: string, items: Array<{ path: string; kind: string }>) => {
      if (items.length) {
        console.log('\n' + title + ':');
        for (const item of items) console.log('  ' + item.kind.padEnd(8) + item.path);
      }
    };
    print('Changes staged for commit', result.staged);
    print('Changes not staged', result.unstaged);
    if (result.untracked.length) {
      console.log('\nUntracked files:');
      for (const file of result.untracked) console.log('  ' + file);
    }
    if (!result.staged.length && !result.unstaged.length && !result.untracked.length) console.log('Working tree clean.');
  });

program.command('add')
  .description('Stage file or directory changes')
  .argument('[paths...]', 'files or directories')
  .option('-A, --all', 'stage all additions, modifications, and deletions')
  .action(async (paths: string[], options: { all?: boolean }) => {
    const result = await stagePaths(process.cwd(), paths, Boolean(options.all));
    console.log('Staging updated. ' + result.staged + ' changed file(s), ' + result.removed + ' deletion(s).');
  });

program.command('commit')
  .description('Create a named snapshot from staged files')
  .requiredOption('-m, --message <message>', 'commit message')
  .action(async (options: { message: string }) => {
    const result = await createCommit(process.cwd(), options.message);
    const shown = result.id.slice(0, 8);
    const summary = await showCommit(process.cwd(), result.id);
    console.log('[' + (await findRepository()).root.split('/').pop() + ' ' + shown + '] ' + result.commit.message);
    console.log(' ' + summary.paths.length + ' path(s) changed');
  });

program.command('log')
  .description('Show commit history')
  .option('-n, --limit <number>', 'maximum commits to show', '20')
  .action(async (options: { limit: string }) => {
    const commits = await listLog(process.cwd(), Number(options.limit));
    if (!commits.length) {
      console.log('No commits yet.');
      return;
    }
    for (const item of commits) {
      console.log('commit ' + item.id);
      console.log('Author: ' + item.commit.author.name + ' <' + item.commit.author.email + '>');
      console.log('Date:   ' + item.commit.timestamp);
      console.log('\n    ' + item.commit.message + '\n');
    }
  });

program.command('show')
  .description('Show a commit and its changed paths')
  .argument('[revision]', 'commit ID, branch, or HEAD~1', 'HEAD')
  .action(async (revision: string) => {
    const result = await showCommit(process.cwd(), revision);
    console.log('commit ' + result.id);
    console.log('Author: ' + result.commit.author.name + ' <' + result.commit.author.email + '>');
    console.log('Date:   ' + result.commit.timestamp);
    console.log('\n    ' + result.commit.message + '\n');
    console.log(result.paths.length + ' changed path(s):');
    for (const file of result.paths) console.log('  ' + file);
  });

program.command('diff')
  .description('Show working-tree or staged text differences')
  .option('--staged', 'compare staged snapshot with HEAD')
  .action(async (options: { staged?: boolean }) => {
    process.stdout.write(await diffRepository(process.cwd(), Boolean(options.staged)));
  });

program.command('restore')
  .description('Restore selected paths from a commit without changing commit history')
  .argument('<paths...>', 'paths to restore')
  .requiredOption('--source <revision>', 'source commit, branch, or HEAD~1')
  .option('--force', 'allow overwriting local changes after reviewing them')
  .action(async (paths: string[], options: { source: string; force?: boolean }) => {
    const result = await restorePaths(process.cwd(), options.source, paths, Boolean(options.force));
    for (const file of result.restored) console.log('restored ' + file);
    for (const file of result.removed) console.log('removed  ' + file);
    console.log('Restored working files only; commit history and staging index were not changed.');
  });

program.command('config')
  .description('Set local repository identity')
  .argument('<key>', 'user.name or user.email')
  .argument('<value>', 'value')
  .action(async (key: string, value: string) => {
    await setRepositoryConfig(process.cwd(), key, value);
    console.log('Set ' + key + '.');
  });

program.command('doctor')
  .description('Verify repository metadata and all reachable object hashes')
  .action(async () => {
    const repo = await findRepository();
    const state = await statusRepository();
    const verified = await verifyRepository();
    console.log('Repository: ' + repo.root);
    console.log('Format: ' + repo.config.formatVersion);
    console.log('Branch: ' + state.branch);
    console.log('Verified ' + verified.commits + ' commit(s), ' + verified.trees + ' tree(s), and ' + verified.blobs + ' blob(s).');
  });

program.command('push')
  .description('Google Drive remote sync (not implemented yet)')
  .action(() => {
    throw new Error('Google Drive push is not implemented yet. Local snapshots are available; remote sync is the next milestone.');
  });

program.command('pull')
  .description('Google Drive remote sync (not implemented yet)')
  .action(() => {
    throw new Error('Google Drive pull is not implemented yet. Remote sync is the next milestone.');
  });

program.showHelpAfterError();
try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error('drivegit: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
