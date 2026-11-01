import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fault} from './errors.mjs';

const sensitive = /^(?:\.env(?:\..*)?|\.ssh|\.bridge_headers|\.xiaoman-vault|credentials?(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|dpapi|token)|config(?:\.(?:phone|local))?\.json|cordis\.patch\.ya?ml|model-prefs\.json)$/i;
const binary = /\.(?:db|sqlite3?|db-wal|db-shm|onnx|pth|index|gz|zst|zstd|zip|tgz|exe|dll|so|png|jpe?g|gif|webp|mp[34]|wav|ogg)$/i;
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
const identity = stat => [stat.dev, stat.ino].map(String).join(':');
const revision = stat => createHash('sha256').update(stamp(stat)).digest('hex');
function relativePath(value = '') {
  if (typeof value !== 'string' || value.length > 2048 || /[\\:\x00-\x1f\x7f]/.test(value) || value.startsWith('/') || value.split('/').some(part => part === '..' || part === '.')) throw fault('PATH_DENIED');
  return value.replace(/\/$/, '');
}
function bounded(value, fallback, maximum) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw fault('INVALID_RANGE');
  return number;
}

export async function createFileStore(roots, {maxReadBytes = 65536, maxEntries = 200} = {}) {
  if (!Array.isArray(roots) || !roots.length || roots.length > 16) throw fault('ROOTS_REQUIRED');
  if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes < 1 || maxReadBytes > 1024 * 1024 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) throw fault('INVALID_LIMIT');
  const registered = new Map();
  for (const entry of roots) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(entry.id || '') || registered.has(entry.id) || !path.isAbsolute(entry.path || '')) throw fault('INVALID_ROOT');
    const info = await fs.lstat(entry.path, {bigint: true});
    if (!info.isDirectory() || info.isSymbolicLink()) throw fault('SYMLINK_DENIED');
    const actual = await fs.realpath(entry.path);
    if (actual.split(path.sep).some(part => sensitive.test(part))) throw fault('SENSITIVE_FILE');
    // Ancestor aliases are rejected as well; Proot roots must be validated in that environment.
    if (path.resolve(actual) !== path.resolve(entry.path)) throw fault('SYMLINK_DENIED');
    registered.set(entry.id, {id: entry.id, label: String(entry.label || entry.id).slice(0, 80), actual, identity: identity(info)});
  }
  async function resolve(rootId, name = '') {
    const root = registered.get(rootId);
    if (!root) throw fault('PATH_DENIED');
    const relative = relativePath(name);
    if (relative.split('/').some(part => sensitive.test(part))) throw fault('SENSITIVE_FILE');
    const initial = await fs.lstat(root.actual, {bigint: true});
    if (initial.isSymbolicLink() || identity(initial) !== root.identity) throw fault('SOURCE_CHANGED');
    let current = root.actual;
    const parents = [{file: current, stamp: stamp(initial)}];
    const pieces = relative ? relative.split('/') : [];
    for (let i = 0; i < pieces.length; i++) {
      current = path.join(current, pieces[i]);
      let info;
      try { info = await fs.lstat(current, {bigint: true}); } catch (error) { if (error.code === 'ENOENT') throw fault('NOT_FOUND'); throw error; }
      if (info.isSymbolicLink()) throw fault('SYMLINK_DENIED');
      if (i < pieces.length - 1 && !info.isDirectory()) throw fault('PATH_DENIED');
      if (info.isDirectory()) parents.push({file: current, stamp: stamp(info)});
    }
    if (!within(root.actual, await fs.realpath(current))) throw fault('PATH_DENIED');
    return {root, relative, file: current, parents};
  }
  async function checkParents(item) {
    for (const parent of item.parents) {
      const current = await fs.lstat(parent.file, {bigint: true});
      if (current.isSymbolicLink() || stamp(current) !== parent.stamp) throw fault('SOURCE_CHANGED');
    }
  }
  const metadata = (info, name) => ({name, kind: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'blocked', bytes: Number(info.size), modifiedAt: info.mtime.toISOString(), revision: revision(info)});
  return Object.freeze({
    roots: () => [...registered.values()].map(({id, label}) => ({id, label})),
    async stat(rootId, name) {
      const item = await resolve(rootId, name);
      const info = await fs.lstat(item.file, {bigint: true});
      await checkParents(item);
      return {root: rootId, path: item.relative, ...metadata(info, path.basename(item.file))};
    },
    async list(rootId, name = '', options = {}) {
      const offset = bounded(options.offset, 0, 1000000), limit = bounded(options.limit, maxEntries, maxEntries);
      if (limit === 0) throw fault('INVALID_RANGE');
      const item = await resolve(rootId, name);
      const before = await fs.lstat(item.file, {bigint: true});
      if (!before.isDirectory()) throw fault('NOT_DIRECTORY');
      if (options.revision && options.revision !== revision(before)) throw fault('REVISION_CHANGED');
      // Iterate rather than collect the whole directory. The scan itself has a hard bound.
      const directory = await fs.opendir(item.file);
      const entries = [], omitted = {sensitive: 0, symlink: 0, special: 0}; let visible = 0, scanned = 0, more = false;
      for await (const entry of directory) {
        if (++scanned > 10000) throw fault('DIRECTORY_LIMIT');
        if (sensitive.test(entry.name)) { omitted.sensitive++; continue; }
        // Dirent d_type can disagree with Proot's translated lstat view. Treat
        // directory entries as names only, then apply the policy to lstat data.
        const file = path.join(item.file, entry.name);
        let info;
        try { info = await fs.lstat(file, {bigint: true}); }
        catch (error) { if (error.code === 'ENOENT') throw fault('SOURCE_CHANGED'); throw error; }
        if (info.isSymbolicLink()) { omitted.symlink++; continue; }
        if (!info.isFile() && !info.isDirectory()) { omitted.special++; continue; }
        if (visible++ < offset) continue;
        if (entries.length === limit) { more = true; break; }
        entries.push({...metadata(info, entry.name), path: item.relative ? `${item.relative}/${entry.name}` : entry.name});
      }
      await checkParents(item);
      if (stamp(before) !== stamp(await fs.lstat(item.file, {bigint: true}))) throw fault('SOURCE_CHANGED');
      return {root: rootId, path: item.relative, revision: revision(before), entries, nextOffset: more ? offset + entries.length : null, scannedEntries: scanned, omitted, observedAt: new Date().toISOString()};
    },
    async read(rootId, name, options = {}) {
      const offset = bounded(options.offset, 0, Number.MAX_SAFE_INTEGER), limit = bounded(options.limit, maxReadBytes, maxReadBytes);
      if (!limit) throw fault('INVALID_RANGE');
      const item = await resolve(rootId, name);
      if (binary.test(item.relative)) throw fault('PREVIEW_UNSUPPORTED');
      const expected = await fs.lstat(item.file, {bigint: true});
      if (!expected.isFile()) throw fault('NOT_REGULAR_FILE');
      if (expected.nlink !== 1n) throw fault('HARDLINK_DENIED');
      if (options.revision && options.revision !== revision(expected)) throw fault('REVISION_CHANGED');
      const handle = await fs.open(item.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const before = await handle.stat({bigint: true});
        if (!before.isFile() || stamp(before) !== stamp(expected)) throw fault('SOURCE_CHANGED');
        const head = Buffer.alloc(16); const header = await handle.read(head, 0, 16, 0);
        if (head.toString('ascii').startsWith('SQLite format 3') || head.subarray(0, header.bytesRead).includes(0)) throw fault('PREVIEW_UNSUPPORTED');
        const buffer = Buffer.alloc(Math.min(limit, Math.max(0, Number(before.size) - offset)));
        const {bytesRead} = await handle.read(buffer, 0, buffer.length, offset);
        if (buffer.subarray(0, bytesRead).includes(0)) throw fault('PREVIEW_UNSUPPORTED');
        const after = await handle.stat({bigint: true});
        if (stamp(before) !== stamp(after) || stamp(after) !== stamp(await fs.lstat(item.file, {bigint: true}))) throw fault('SOURCE_CHANGED');
        await checkParents(item);
        return {root: rootId, path: item.relative, mode: 'live', observedAt: new Date().toISOString(), revision: revision(after), offset, bytesRead, totalBytes: Number(after.size), truncated: offset + bytesRead < Number(after.size), text: buffer.subarray(0, bytesRead).toString('utf8')};
      } finally { await handle.close(); }
    },
  });
}
