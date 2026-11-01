const $ = id => document.getElementById(id);
let token = '', directory = '', nextOffset = null, directoryRevision, controller, selected = null, sequence = 0;
function resetPreview() { selected = null; $('filename').textContent = '选择一个文件'; $('metadata').textContent = '当前文件预览'; $('metadata').classList.remove('stale'); $('preview').textContent = '点击左侧的目录或文件。'; }
async function api(route, query, signal) {
  const response = await fetch(`/api/${route}${query ? '?' + new URLSearchParams(query) : ''}`, {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal});
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.errorCode || '连接失败');
  return data;
}
function failure(error) {
  if (error.name === 'AbortError') return;
  $('connection').textContent = `连接或读取失败：${error.message}。已显示的内容可能过期，请重新刷新。`;
  $('connection').classList.add('stale'); $('metadata').classList.add('stale');
}
async function vault() {
  try { const data = await api('vault'); $('vault').textContent = data.available && data.lastVerified ? `${data.lastVerified.verifiedAt} · ${data.lastVerified.snapshotId.slice(0, 12)} · ${data.lastVerified.files ?? '?'} 个文件` : '未配置或暂无可用的已验证恢复点。'; } catch { $('vault').textContent = '备份状态暂不可用。'; }
}
async function load(append = false) {
  controller?.abort(); controller = new AbortController(); const current = ++sequence;
  try {
    const args = {root: $('roots').value, path: directory};
    if (append) { args.offset = nextOffset; args.revision = directoryRevision; }
    const data = await api('list', args, controller.signal);
    if (current !== sequence) return;
    if (!append) $('entries').replaceChildren();
    directoryRevision = data.revision; nextOffset = data.nextOffset;
    for (const entry of data.entries) {
      const li = document.createElement('li'), button = document.createElement('button');
      button.textContent = `${entry.kind === 'directory' ? '▸ ' : '· '}${entry.name}`;
      button.addEventListener('click', () => { if (entry.kind === 'directory') { directory = entry.path; resetPreview(); load(); } else read(entry); });
      li.append(button); $('entries').append(li);
    }
    $('location').textContent = directory || '/'; $('more').hidden = nextOffset === null;
    const omitted = data.omitted || {}, hidden = (omitted.sensitive || 0) + (omitted.symlink || 0) + (omitted.special || 0);
    const note = $('directory-note');
    if (!$('entries').children.length) {
      note.textContent = data.scannedEntries === 0 ? '这个目录目前是空的。' : hidden ? `本次扫描有 ${hidden} 项因敏感文件、符号链接或特殊类型而未展示。` : '服务未返回可显示的条目；可能是空目录或被旧版服务过滤。';
      note.hidden = false;
    } else { note.textContent = hidden ? `本次扫描未展示 ${hidden} 项受限条目。` : ''; note.hidden = !hidden; }
    $('connection').textContent = `手机在线 · 目录读取于 ${data.observedAt}`; $('connection').classList.remove('stale');
    return true;
  } catch (error) { if (current === sequence) failure(error); }
}
async function read(entry, fresh = false) {
  selected = entry;
  controller?.abort(); controller = new AbortController(); const current = ++sequence;
  try {
    const root = $('roots').value;
    const version = fresh ? await api('stat', {root, path: entry.path}, controller.signal) : entry;
    if (current !== sequence) return;
    const data = await api('read', {root, path: entry.path, revision: version.revision}, controller.signal);
    if (current !== sequence) return;
    $('filename').textContent = entry.name; $('preview').textContent = data.totalBytes === 0 ? '这个文件目前为空（0 字节）。' : data.text;
    $('metadata').textContent = `在线读取于 ${data.observedAt} · ${data.bytesRead}/${data.totalBytes} 字节${data.truncated ? ' · 预览已截断' : ''}`;
    $('metadata').classList.remove('stale'); $('connection').classList.remove('stale'); $('connection').textContent = '手机在线 · 已读取当前文件版本';
  } catch (error) { if (current === sequence) failure(error); }
}
$('login').addEventListener('submit', async event => {
  event.preventDefault(); token = $('token').value.trim(); $('token').value = '';
  try {
    const data = await api('roots'); $('roots').replaceChildren();
    for (const root of data.roots) { const option = document.createElement('option'); option.value = root.id; option.textContent = root.label; $('roots').append(option); }
    $('login').hidden = true; $('workspace').hidden = false; directory = ''; await load(); vault();
  } catch (error) { token = ''; $('login').hidden = false; alert(`无法连接：${error.message}`); }
});
$('roots').addEventListener('change', () => { directory = ''; resetPreview(); load(); });
$('up').addEventListener('click', () => { directory = directory.split('/').slice(0, -1).join('/'); resetPreview(); load(); });
$('refresh').addEventListener('click', async () => { if (await load()) { if (selected) await read(selected, true); } vault(); });
$('more').addEventListener('click', () => load(true));
$('logout').addEventListener('click', () => { token = ''; sequence++; controller?.abort(); $('entries').replaceChildren(); resetPreview(); $('vault').textContent = ''; $('workspace').hidden = true; $('login').hidden = false; });
