const api = CFNStore.api;
const $ = id => document.getElementById(id);

function status(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('err', error);
}

async function refreshStats() {
  const docs = await CFNStore.all();
  let bytes = null;
  try {
    bytes = await api.storage.local.getBytesInUse(null);
  } catch {
    // not available in every browser
  }
  const size = bytes == null ? '' : ` · ${(bytes / 1024).toFixed(1)} KB used`;
  $('stats').textContent = `${docs.length} problem${docs.length === 1 ? '' : 's'} with notes${size}`;
}

// ---- notes folder
async function refreshFolder() {
  if (!CFNFolder.supported) {
    $('folder-unsupported').hidden = false;
    for (const id of ['folder-choose', 'folder-backup', 'folder-restore', 'folder-forget']) $(id).hidden = true;
    return;
  }
  const dir = await CFNFolder.handle();
  $('folder-backup').disabled = $('folder-restore').disabled = $('folder-forget').disabled = !dir;
  $('folder-choose').textContent = dir ? 'Change folder' : 'Choose folder';
  if (!dir) return status($('folder-status'), 'No folder chosen yet.');
  const last = await CFNFolder.lastBackup();
  const granted = await CFNFolder.permitted(dir);
  status(
    $('folder-status'),
    `Folder: “${dir.name}”${last ? ` · last backup ${new Date(last).toLocaleString()}` : ''}${granted ? '' : ' · click “Back up now” to re-allow access'}`,
  );
}

async function withFolder(fn) {
  try {
    const dir = await CFNFolder.handle();
    if (!dir) return;
    if (!(await CFNFolder.permitted(dir, true))) return status($('folder-status'), 'Folder access was not allowed.', true);
    await fn(dir);
  } catch (err) {
    status($('folder-status'), err.message, true);
  }
}

$('folder-choose').addEventListener('click', async () => {
  try {
    const dir = await CFNFolder.choose();
    await CFNFolder.backup(dir, await CFNStore.all());
    await refreshFolder();
  } catch (err) {
    if (err.name !== 'AbortError') status($('folder-status'), err.message, true);
  }
});

$('folder-backup').addEventListener('click', () =>
  withFolder(async dir => {
    const n = await CFNFolder.backup(dir, await CFNStore.all());
    await refreshFolder();
    status($('folder-status'), `${$('folder-status').textContent} · wrote ${n} problem${n === 1 ? '' : 's'}`);
  }),
);

$('folder-restore').addEventListener('click', () =>
  withFolder(async dir => {
    const n = await CFNStore.merge(await CFNFolder.read(dir));
    status($('folder-status'), `Restored ${n} problem${n === 1 ? '' : 's'} from the folder.`);
    refreshStats();
  }),
);

$('folder-forget').addEventListener('click', async () => {
  await CFNFolder.forget();
  refreshFolder();
});

// ---- export / import
$('export').addEventListener('click', async () => {
  const docs = await CFNStore.all();
  const blob = new Blob([JSON.stringify({ app: 'cf-notes', v: 1, exportedAt: new Date().toISOString(), docs }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `noteforces-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status($('io-status'), `Exported ${docs.length} problem${docs.length === 1 ? '' : 's'}.`);
});

$('import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const docs = Array.isArray(data) ? data : data.docs;
    if (!Array.isArray(docs)) throw new Error('This file is not a NoteForces backup.');
    const n = await CFNStore.merge(docs);
    status($('io-status'), `Imported ${n} problem${n === 1 ? '' : 's'} (${docs.length - n} already up to date).`);
    refreshStats();
  } catch (err) {
    status($('io-status'), `Import failed: ${err.message}`, true);
  }
});

// ---- delete
$('wipe').addEventListener('click', async () => {
  if (!confirm('Delete ALL NoteForces data in this browser? Files in your notes folder are not touched.')) return;
  await CFNStore.removeAll();
  refreshStats();
});

refreshStats();
refreshFolder();
