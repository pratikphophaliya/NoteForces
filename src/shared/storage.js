// Local, offline storage for problem notes. One record per problem, keyed by problem id.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const PREFIX = 'cfn:problem:';

  const Store = {
    api,
    PREFIX,

    key(id) {
      return PREFIX + id;
    },

    blank(meta) {
      const now = Date.now();
      return { v: 1, ...meta, note: '', highlights: [], items: [], createdAt: now, updatedAt: now };
    },

    isEmpty(doc) {
      return !doc.note?.trim() && !doc.highlights?.length && !doc.items?.length;
    },

    async get(id) {
      const k = Store.key(id);
      const r = await api.storage.local.get(k);
      return r[k] ?? null;
    },

    // Empty records are removed so the notes list only shows problems you actually annotated.
    async put(doc) {
      if (Store.isEmpty(doc)) await api.storage.local.remove(Store.key(doc.id));
      else await api.storage.local.set({ [Store.key(doc.id)]: doc });
    },

    async putMany(docs) {
      const out = {};
      for (const d of docs) out[Store.key(d.id)] = d;
      if (docs.length) await api.storage.local.set(out);
    },

    async remove(id) {
      await api.storage.local.remove(Store.key(id));
    },

    async all() {
      const r = await api.storage.local.get(null);
      return Object.keys(r).filter(k => k.startsWith(PREFIX)).map(k => r[k]);
    },

    async removeAll() {
      const r = await api.storage.local.get(null);
      await api.storage.local.remove(Object.keys(r).filter(k => k.startsWith(PREFIX)));
    },

    // Merge docs into storage, keeping whichever copy was edited most recently.
    async merge(docs) {
      const valid = docs.filter(d => d && typeof d.id === 'string' && Array.isArray(d.items ?? []));
      const current = new Map((await Store.all()).map(d => [d.id, d]));
      const newer = valid.filter(d => !current.has(d.id) || (d.updatedAt ?? 0) > (current.get(d.id).updatedAt ?? 0));
      await Store.putMany(newer);
      return newer.length;
    },

    onChange(cb) {
      api.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        for (const [k, c] of Object.entries(changes)) {
          if (k.startsWith(PREFIX)) cb(k.slice(PREFIX.length), c.newValue ?? null);
        }
      });
    },
  };

  globalThis.CFNStore = Store;
})();
