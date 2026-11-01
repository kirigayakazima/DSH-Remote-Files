import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createFileStore} from '../lib/files.mjs';
import {fixture} from './helpers.mjs';

test('bounded live reads and pagination preserve source identity and contents', async t => {
  const f = fixture(t); const file = path.join(f.source, 'note.md');
  fs.writeFileSync(file, 'hello 小满'); fs.writeFileSync(path.join(f.source, 'other.md'), 'second');
  const before = fs.statSync(file, {bigint: true}); const store = await createFileStore(f.roots, {maxReadBytes: 8});
  assert.deepEqual(store.roots(), [{id: 'test', label: '合成文件'}]);
  const first = await store.list('test', '', {limit: 1}); assert.equal(first.entries.length, 1); assert.equal(first.nextOffset, 1);
  const second = await store.list('test', '', {limit: 1, offset: 1, revision: first.revision}); assert.equal(second.entries.length, 1); assert.equal(second.nextOffset, null);
  assert.notEqual(first.entries[0].name, second.entries[0].name);
  const read = await store.read('test', 'note.md', {limit: 5}); assert.equal(read.text, 'hello'); assert.equal(read.truncated, true); assert.equal(read.mode, 'live');
  await assert.rejects(store.read('test', 'note.md', {limit: 100}), /INVALID_RANGE/);
  const after = fs.statSync(file, {bigint: true});
  for (const key of ['dev', 'ino', 'nlink', 'uid', 'gid', 'mode', 'mtimeNs', 'ctimeNs', 'size']) assert.equal(after[key], before[key]);
});

test('denies traversal, secrets, links, hard links, binary and live SQLite bytes', async t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'private.md'), 'secret');
  fs.writeFileSync(path.join(f.source, 'config.json'), 'sensitive'); fs.writeFileSync(path.join(f.source, '.env'), 'private');
  fs.symlinkSync(outside, path.join(f.source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(f.source, 'database'), Buffer.from('SQLite format 3\0payload'));
  fs.writeFileSync(path.join(f.source, 'binary'), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(f.source, 'linked.md'), 'synthetic link fixture'); fs.linkSync(path.join(f.source, 'linked.md'), path.join(outside, 'alias.md'));
  const store = await createFileStore(f.roots);
  for (const name of ['../outside/private.md', '/etc/passwd', 'C:/secret', 'x\\y', './note', 'x\0y']) await assert.rejects(store.read('test', name), /PATH_DENIED/);
  for (const name of ['config.json', '.env']) await assert.rejects(store.read('test', name), /SENSITIVE_FILE/);
  await assert.rejects(store.read('test', 'escape/private.md'), /SYMLINK_DENIED/);
  await assert.rejects(store.read('test', 'linked.md'), /HARDLINK_DENIED/);
  for (const name of ['database', 'binary']) await assert.rejects(store.read('test', name), /PREVIEW_UNSUPPORTED/);
  assert.ok(!(await store.list('test')).entries.some(x => ['.env', 'config.json', 'escape'].includes(x.name)));
});

test('stale revision and replacement between resolve/open fail closed', async t => {
  const f = fixture(t), file = path.join(f.source, 'note.md'); fs.writeFileSync(file, 'old');
  const store = await createFileStore(f.roots); const stat = await store.stat('test', 'note.md');
  fs.writeFileSync(file, 'new content');
  await assert.rejects(store.read('test', 'note.md', {revision: stat.revision}), /REVISION_CHANGED/);
  const original = fsp.open;
  t.mock.method(fsp, 'open', async (...args) => { fs.writeFileSync(file, 'changed during open'); return original(...args); });
  await assert.rejects(store.read('test', 'note.md'), /SOURCE_CHANGED/);
});

test('root replacement cannot silently grant a new directory', async t => {
  const f = fixture(t); const store = await createFileStore(f.roots);
  fs.renameSync(f.source, path.join(f.root, 'previous')); fs.mkdirSync(f.source);
  await assert.rejects(store.list('test'), /SOURCE_CHANGED/);
});

test('directory listing uses lstat when Proot Dirent hints misclassify files; real symlinks remain hidden', async t => {
  const f = fixture(t);
  for (const name of ['notebook.md', 'voice.md', 'unknown.md']) fs.writeFileSync(path.join(f.source, name), 'synthetic text');
  fs.writeFileSync(path.join(f.source, 'config.json'), 'private fixture');
  const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const opendir = fsp.opendir.bind(fsp);
  t.mock.method(fsp, 'opendir', async (...args) => {
    const directory = await opendir(...args);
    return {async *[Symbol.asyncIterator]() {
      for await (const entry of directory) {
        if (entry.name === 'notebook.md' || entry.name === 'voice.md') yield {name: entry.name, isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false};
        else if (entry.name === 'unknown.md') yield {name: entry.name, isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false};
        else yield entry;
      }
    }};
  });
  const store = await createFileStore(f.roots), found = [];
  let offset = 0, revision;
  do {
    const page = await store.list('test', '', {limit: 1, offset, revision});
    assert.equal(page.entries.length, 1); found.push(page.entries[0].name);
    revision = page.revision; offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(found.sort(), ['notebook.md', 'unknown.md', 'voice.md']);
  const whole = await store.list('test');
  assert.equal(whole.omitted.symlink, 1); assert.equal(whole.omitted.sensitive, 1);
  await assert.rejects(store.stat('test', 'escape'), /SYMLINK_DENIED/);
  assert.equal((await store.read('test', 'notebook.md')).text, 'synthetic text');
  fs.mkdirSync(path.join(f.source, 'empty'));
  const empty = await store.list('test', 'empty');
  assert.equal(empty.scannedEntries, 0); assert.deepEqual(empty.entries, []);
});
