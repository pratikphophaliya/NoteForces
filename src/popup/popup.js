const api = CFNStore.api;
const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
let docs = [];

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]];
  for (const [u, n] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
}

function summary(d) {
  const parts = [];
  if (d.highlights?.length) parts.push(`${d.highlights.length} highlight${d.highlights.length > 1 ? 's' : ''}`);
  const drawings = (d.items ?? []).filter(i => i.kind !== 'text').length;
  const texts = (d.items ?? []).length - drawings;
  if (drawings) parts.push(`${drawings} drawing${drawings > 1 ? 's' : ''}`);
  if (texts) parts.push(`${texts} text box${texts > 1 ? 'es' : ''}`);
  parts.push(ago(d.updatedAt));
  return parts.join(' · ');
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const shown = q
    ? docs.filter(d => [d.title, d.id, d.note, ...(d.highlights ?? []).map(h => h.quote)].join('\n').toLowerCase().includes(q))
    : docs;
  listEl.replaceChildren(
    ...shown.map(d => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = d.url;
      a.addEventListener('click', e => {
        e.preventDefault();
        api.tabs.create({ url: d.url });
      });
      const t = document.createElement('div');
      t.className = 't';
      const name = document.createElement('span');
      name.textContent = d.title || d.id;
      const id = document.createElement('span');
      id.className = 'id';
      id.textContent = d.id;
      t.append(name, id);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = summary(d);
      a.append(t, meta);
      if (d.note?.trim()) {
        const snip = document.createElement('div');
        snip.className = 'snip';
        snip.textContent = d.note.trim();
        a.append(snip);
      }
      li.append(a);
      return li;
    }),
  );
  document.getElementById('empty').hidden = docs.length > 0;
}

document.getElementById('options').addEventListener('click', () => api.runtime.openOptionsPage());
searchEl.addEventListener('input', render);

(async () => {
  docs = (await CFNStore.all()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  document.getElementById('count').textContent = `${docs.length} problem${docs.length === 1 ? '' : 's'} with notes`;
  render();
  if (docs.length) searchEl.focus();
  if (await CFNFolder.autoBackup()) document.getElementById('foot').textContent = 'Stored offline · backed up to your notes folder';
})();
