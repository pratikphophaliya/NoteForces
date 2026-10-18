// Optional mirror of all notes into a folder you pick on disk (Chrome/Edge File System Access API).
// Writes problems/<id>.json (full data, restorable) and notes/<id>.md (readable without the extension).
(() => {
  const DB = 'cfn-folder';
  const KV = 'kv';
  const supported = typeof globalThis.showDirectoryPicker === 'function';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(KV);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function kv(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(KV, mode).objectStore(KV));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const get = k => kv('readonly', s => s.get(k));
  const set = (k, v) => kv('readwrite', s => s.put(v, k));
  const del = k => kv('readwrite', s => s.delete(k));

  const safeName = id => id.replace(/[^A-Za-z0-9_-]/g, '_');

  function toMarkdown(d) {
    const lines = [`# ${d.title || d.id}`, '', `<${d.url}>`, '', `_Last edited ${new Date(d.updatedAt).toLocaleString()}_`, ''];
    if (d.note?.trim()) lines.push('## Notes', '', d.note.trim(), '');
    if (d.highlights?.length) {
      lines.push('## Highlights', '');
      for (const h of d.highlights) lines.push(`- ${h.quote.replace(/\s+/g, ' ')}`);
      lines.push('');
    }
    const texts = (d.items ?? []).filter(i => i.kind === 'text' && i.text?.trim());
    if (texts.length) {
      lines.push('## Text boxes', '');
      for (const t of texts) lines.push(`- ${t.text.trim().replace(/\n/g, ' / ')}`);
      lines.push('');
    }
    const drawings = (d.items ?? []).filter(i => i.kind !== 'text').length;
    if (drawings) lines.push(`_${drawings} drawing(s) — open the problem with NoteForces to see them._`, '');
    return lines.join('\n');
  }

  async function writeFile(dir, name, contents) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(contents);
    await w.close();
  }

  const Folder = {
    supported,

    async handle() {
      return supported ? (await get('dir')) ?? null : null;
    },

    async choose() {
      const dir = await showDirectoryPicker({ id: 'cf-notes', mode: 'readwrite' });
      await set('dir', dir);
      return dir;
    },

    async forget() {
      await del('dir');
      await del('lastBackup');
    },

    async permitted(dir, ask = false) {
      const opts = { mode: 'readwrite' };
      if ((await dir.queryPermission(opts)) === 'granted') return true;
      return ask && (await dir.requestPermission(opts)) === 'granted';
    },

    lastBackup: () => get('lastBackup'),

    async backup(dir, docs) {
      const json = await dir.getDirectoryHandle('problems', { create: true });
      const md = await dir.getDirectoryHandle('notes', { create: true });
      for (const d of docs) {
        await writeFile(json, `${safeName(d.id)}.json`, JSON.stringify(d, null, 2));
        await writeFile(md, `${safeName(d.id)}.md`, toMarkdown(d));
      }
      await set('lastBackup', Date.now());
      return docs.length;
    },

    async read(dir) {
      const json = await dir.getDirectoryHandle('problems', { create: false });
      const docs = [];
      for await (const [name, fh] of json.entries()) {
        if (fh.kind !== 'file' || !name.endsWith('.json')) continue;
        try {
          docs.push(JSON.parse(await (await fh.getFile()).text()));
        } catch {
          // skip files that aren't valid notes
        }
      }
      return docs;
    },

    // Silent backup used by the popup: only runs if permission is already granted.
    async autoBackup() {
      try {
        const dir = await Folder.handle();
        if (!dir || !(await Folder.permitted(dir))) return false;
        await Folder.backup(dir, await CFNStore.all());
        return true;
      } catch {
        return false;
      }
    },
  };

  globalThis.CFNFolder = Folder;
})();
