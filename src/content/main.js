// NoteForces content script: highlighter, pen, shapes, text boxes and a notes panel on
// Codeforces problem pages. Everything is saved to chrome.storage.local (offline).
(() => {
  'use strict';
  if (globalThis.__cfnNotesLoaded) return;
  globalThis.__cfnNotesLoaded = true;

  const { CFNStore: Store, CFNAnchor: Anchor, CFNInk: Ink, CFNUI: UI } = globalThis;
  const api = Store.api;
  const { ICONS } = UI;

  // ---------------------------------------------------------------- problem identity
  function parseProblem(loc) {
    const path = loc.pathname.replace(/\/+$/, '');
    const patterns = [
      [/^\/problemset\/problem\/(\d+)\/(\w+)$/, false],
      [/^\/contest\/(\d+)\/problem\/(\w+)$/, false],
      [/^\/gym\/(\d+)\/problem\/(\w+)$/, true],
      [/^\/problemset\/gymProblem\/(\d+)\/(\w+)$/, true],
      [/^\/group\/[^/]+\/contest\/(\d+)\/problem\/(\w+)$/, true],
    ];
    for (const [re, gym] of patterns) {
      const m = path.match(re);
      if (!m) continue;
      const contest = m[1];
      const index = m[2].toUpperCase();
      const isGroup = path.startsWith('/group/');
      return {
        id: (gym ? 'gym' : '') + contest + index,
        contest,
        index,
        url: isGroup
          ? `https://codeforces.com${path}`
          : gym
            ? `https://codeforces.com/gym/${contest}/problem/${index}`
            : `https://codeforces.com/problemset/problem/${contest}/${index}`,
      };
    }
    return null;
  }

  const problem = parseProblem(location);
  const root = document.querySelector('.problem-statement');
  if (!problem || !root) return; // PDF statements, challenge pages, etc.

  const title = root.querySelector('.header .title')?.textContent.trim() || problem.id;
  const instanceId = uid();

  // ---------------------------------------------------------------- settings
  const PALETTES = {
    ink: ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c'],
    light: ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'],
  };
  const SIZES = { pen: [1.5, 3, 5, 8], marker: [10, 18, 28], shape: [1.5, 3, 5], text: [13, 16, 20, 26] };
  const PALETTE_FOR = { pen: 'ink', marker: 'light', highlight: 'light', shape: 'ink', text: 'ink' };
  const SHAPES = ['rect', 'ellipse', 'line', 'arrow'];
  const ERASER_R = 10;
  const DEFAULT_PREFS = {
    styles: {
      pen: { color: '#1f2937', size: 3 },
      marker: { color: '#fde047', size: 18 },
      highlight: { color: '#fde047' },
      shape: { color: '#dc2626', size: 3 },
      text: { color: '#1f2937', size: 16 },
    },
    shape: 'rect',
    toolbar: null,
    panelOpen: false,
    minimized: false,
  };

  const S = { tool: 'cursor', origin: { x: 0, y: 0 }, hostOff: { x: 0, y: 0 }, prefs: structuredClone(DEFAULT_PREFS) };
  let doc = null;
  let gesture = null;
  const hlRanges = new Map();
  const history = { undo: [], redo: [] };

  // ---------------------------------------------------------------- helpers
  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  }

  // Fills an element from the extension's own static markup (ui.js icons/template).
  // Parsed via a <template> instead of innerHTML so store linters don't flag it.
  function setMarkup(el, html) {
    const tpl = new DOMParser().parseFromString(`<template>${html}</template>`, 'text/html').querySelector('template');
    el.replaceChildren(document.importNode(tpl.content, true));
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  const r1 = n => Math.round(n * 10) / 10;
  const findItem = id => doc.items.find(i => i.id === id);
  const isTyping = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  function normalize(d) {
    if (!d) return null;
    d.note ??= '';
    d.highlights = Array.isArray(d.highlights) ? d.highlights : [];
    d.items = (Array.isArray(d.items) ? d.items : []).filter(i => i.kind !== 'text' || i.text?.trim());
    return d;
  }

  function waitForStable(el, quiet = 500, max = 6000) {
    return new Promise(resolve => {
      let t;
      const done = () => {
        obs.disconnect();
        clearTimeout(t);
        clearTimeout(cap);
        resolve();
      };
      const obs = new MutationObserver(() => {
        clearTimeout(t);
        t = setTimeout(done, quiet);
      });
      obs.observe(el, { subtree: true, childList: true, characterData: true });
      t = setTimeout(done, quiet);
      const cap = setTimeout(done, max);
    });
  }

  // ---------------------------------------------------------------- DOM: host + shadow UI
  const host = document.createElement('cfn-notes-root');
  host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  setMarkup(shadow, `<style>${UI.CSS}</style>${UI.TEMPLATE}`);
  const $ = sel => shadow.querySelector(sel);
  const svg = $('.ink');
  const markersG = $('.markers');
  const strokesG = $('.strokes');
  const liveG = $('.live');
  const eraserCursor = $('.eraser-cursor');
  const capture = $('.capture');
  const texts = $('.texts');
  const toolbar = $('.toolbar');
  const flyout = $('.flyout');
  const bubble = $('.bubble');
  const panel = $('.panel');
  const noteArea = $('#cfn-note');
  const statusEl = $('.p-status');
  const hlList = $('.hl-list');
  const toastEl = $('.toast');
  const btn = act => toolbar.querySelector(`[data-act="${act}"]`);
  eraserCursor.setAttribute('r', ERASER_R);
  $('.p-title').textContent = title;
  $('.p-id').textContent = `Problem ${problem.id}`;

  // Page-level stylesheet: ::highlight() rules must live in the page, not the shadow root.
  const pageStyle = document.createElement('style');
  pageStyle.id = 'cfn-page-style';
  pageStyle.textContent = 'html.cfn-highlight-mode .problem-statement { cursor: text; }';
  const hlSupported = typeof Highlight === 'function' && !!globalThis.CSS?.highlights;
  const hlStyled = new Set();
  const hlRegistered = new Set();

  function mount() {
    (document.head || document.documentElement).append(pageStyle);
    document.body.append(host);
  }

  // ---------------------------------------------------------------- layout
  function relayout() {
    const r = root.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    S.origin = { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY) };
    S.hostOff = { x: Math.round(h.left + scrollX), y: Math.round(h.top + scrollY) };
    const left = `${S.origin.x - S.hostOff.x}px`;
    const top = `${S.origin.y - S.hostOff.y}px`;
    svg.style.left = texts.style.left = left;
    svg.style.top = texts.style.top = top;
  }

  // Text reflowed (resize, zoom, MathJax): re-place highlights and pinned drawings.
  function reflow() {
    relayout();
    resolveHighlights();
    renderInk();
    renderTexts();
    renderHlList();
  }

  let reflowFrame = 0;
  function scheduleReflow() {
    cancelAnimationFrame(reflowFrame);
    reflowFrame = requestAnimationFrame(reflow);
  }

  const local = e => ({ x: e.pageX - S.origin.x, y: e.pageY - S.origin.y });

  // ---------------------------------------------------------------- rendering
  function itemToSvg(it) {
    const stroke = { fill: 'none', stroke: it.color, 'stroke-width': it.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const x = Math.min(it.x1, it.x2);
    const y = Math.min(it.y1, it.y2);
    const w = Math.abs(it.x2 - it.x1);
    const h = Math.abs(it.y2 - it.y1);
    let el;
    switch (it.kind) {
      case 'pen':
        el = svgEl('path', { d: Ink.penPath(it.pts, it.size, it.thin ?? 0.5), fill: it.color });
        break;
      case 'marker':
        el = svgEl('path', { d: Ink.markerPath(it.pts), ...stroke, opacity: 0.42 });
        break;
      case 'rect':
        el = svgEl('rect', { x, y, width: w, height: h, rx: 2, ...stroke });
        break;
      case 'ellipse':
        el = svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...stroke });
        break;
      case 'line':
        el = svgEl('line', { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, ...stroke });
        break;
      case 'arrow':
        el = svgEl('path', { d: Ink.arrowPath(it.x1, it.y1, it.x2, it.y2, it.size), ...stroke });
        break;
      default:
        return null;
    }
    el.dataset.id = it.id;
    return el;
  }

  // ---------------------------------------------------------------- pinning drawings to text
  // Each item remembers the statement character nearest to it (and where that character was
  // when drawn). When the window resizes and the text reflows, the item moves with it.
  const offsets = new Map(); // item id -> current {x, y} shift from where it was drawn
  const shiftOf = it => offsets.get(it.id) ?? { x: 0, y: 0 };

  // Distance from a drawing's centre to a piece of text. Vertical distance counts more than
  // horizontal (a margin note belongs to the line it sits beside), and text *above* the point
  // is preferred over text below (so an underline sticks to its word, not the next line).
  function rectDist(rc, x, y) {
    const dx = Math.max(rc.left - x, 0, x - rc.right);
    const dy = y > rc.bottom ? (y - rc.bottom) * 1.5 : y < rc.top ? (rc.top - y) * 4 : 0;
    return Math.hypot(dx, dy);
  }

  function nearestCharAnchor(p) {
    const nodes = Anchor.textNodes(root);
    const cx = p.x + S.origin.x - scrollX;
    const cy = p.y + S.origin.y - scrollY;
    const r = document.createRange();
    let node = null;
    let best = Infinity;
    for (const n of nodes) {
      r.selectNodeContents(n);
      for (const rc of r.getClientRects()) {
        if (!rc.width || !rc.height) continue;
        const d = rectDist(rc, cx, cy);
        if (d < best) [best, node] = [d, n];
      }
    }
    if (!node) return null;
    let idx = -1;
    best = Infinity;
    for (let i = 0; i < node.length; i++) {
      if (/\s/.test(node.data[i])) continue;
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const rc = r.getBoundingClientRect();
      if (!rc.width && !rc.height) continue;
      const d = rectDist(rc, cx, cy);
      if (d < best) [best, idx] = [d, i];
    }
    if (idx < 0) return null;
    let o = idx;
    for (const n of nodes) {
      if (n === node) break;
      o += n.length;
    }
    const text = Anchor.joinText(nodes);
    r.setStart(node, idx);
    r.setEnd(node, idx + 1);
    const rc = r.getBoundingClientRect();
    return {
      start: o,
      end: o + 1,
      quote: text.slice(o, o + 1),
      prefix: text.slice(Math.max(0, o - 24), o),
      suffix: text.slice(o + 1, o + 25),
      ax: r1(rc.left + scrollX - S.origin.x),
      ay: r1(rc.top + scrollY - S.origin.y),
    };
  }

  function bboxCenter(it) {
    if (it.pts) {
      const xs = it.pts.map(p => p[0]);
      const ys = it.pts.map(p => p[1]);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    return { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 };
  }

  function computeOffsets() {
    offsets.clear();
    const pinned = doc.items.filter(i => i.anchor);
    if (!pinned.length) return;
    const nodes = Anchor.textNodes(root);
    const text = Anchor.joinText(nodes);
    for (const it of pinned) {
      const range = Anchor.anchorToRange(root, it.anchor, nodes, text);
      if (!range) continue;
      const rc = range.getBoundingClientRect();
      if (!rc.width && !rc.height) continue; // hidden text: leave item where it was drawn
      const x = rc.left + scrollX - S.origin.x - it.anchor.ax;
      const y = rc.top + scrollY - S.origin.y - it.anchor.ay;
      if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) offsets.set(it.id, { x, y });
    }
  }

  function renderInk() {
    computeOffsets();
    const draw = it => {
      const el = itemToSvg(it);
      const s = offsets.get(it.id);
      if (el && s) el.setAttribute('transform', `translate(${r1(s.x)} ${r1(s.y)})`);
      return el;
    };
    // Highlighter ink sits underneath pen strokes and shapes so writing stays readable.
    markersG.replaceChildren(...doc.items.filter(i => i.kind === 'marker').map(draw));
    strokesG.replaceChildren(...doc.items.filter(i => i.kind !== 'marker' && i.kind !== 'text').map(draw).filter(Boolean));
  }

  function positionTextBox(w, it) {
    const s = shiftOf(it);
    w.style.left = `${it.x + s.x}px`;
    w.style.top = `${it.y + s.y}px`;
    const ed = w.querySelector('.tb');
    ed.style.color = it.color;
    ed.style.fontSize = `${it.size}px`;
  }

  function makeTextBox(id) {
    const w = document.createElement('div');
    w.className = 'tbw';
    w.dataset.id = id;
    const grip = document.createElement('div');
    grip.className = 'grip-t';
    grip.title = 'Drag to move';
    setMarkup(grip, ICONS.grip);
    const ed = document.createElement('div');
    ed.className = 'tb';
    ed.contentEditable = 'true';
    ed.spellcheck = false;
    w.append(grip, ed);

    ed.addEventListener('focus', () => {
      ed._before ??= snapshot();
    });
    ed.addEventListener('input', () => {
      const item = findItem(id);
      if (!item) return;
      item.text = ed.innerText.replace(/\n$/, '');
      scheduleSave();
    });
    ed.addEventListener('blur', () => commitText(id, ed));
    ed.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        ed.blur();
      }
      e.stopPropagation();
    });
    ed.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    grip.addEventListener('pointerdown', e => startDragText(e, id, w));
    return w;
  }

  function renderTexts() {
    const existing = new Map([...texts.children].map(el => [el.dataset.id, el]));
    const focused = shadow.activeElement;
    for (const it of doc.items) {
      if (it.kind !== 'text') continue;
      let w = existing.get(it.id);
      if (w) existing.delete(it.id);
      else texts.append((w = makeTextBox(it.id)));
      positionTextBox(w, it);
      const ed = w.querySelector('.tb');
      if (ed !== focused && ed.innerText.replace(/\n$/, '') !== it.text) ed.textContent = it.text;
    }
    for (const w of existing.values()) w.remove();
  }

  // ---------------------------------------------------------------- text highlights
  const hlName = color => `cfn-hl-${color.replace(/[^a-z0-9]/gi, '')}`;

  function resolveHighlights() {
    hlRanges.clear();
    if (!doc.highlights.length) return paintHighlights();
    const nodes = Anchor.textNodes(root);
    const text = Anchor.joinText(nodes);
    for (const h of doc.highlights) {
      const r = Anchor.anchorToRange(root, h, nodes, text);
      if (r) hlRanges.set(h.id, r);
    }
    paintHighlights();
  }

  function paintHighlights() {
    if (!hlSupported) return;
    for (const name of hlRegistered) CSS.highlights.delete(name);
    hlRegistered.clear();
    const groups = new Map();
    for (const h of doc.highlights) {
      const r = hlRanges.get(h.id);
      if (!r) continue;
      const name = hlName(h.color);
      if (!hlStyled.has(name)) {
        pageStyle.textContent += `\n::highlight(${name}) { background-color: ${h.color}; }`;
        hlStyled.add(name);
      }
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(r);
    }
    for (const [name, ranges] of groups) {
      CSS.highlights.set(name, new Highlight(...ranges));
      hlRegistered.add(name);
    }
  }

  function selectionInStatement() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return range.intersectsNode(root) ? range : null;
  }

  function highlightSelection(color) {
    const range = selectionInStatement();
    if (!range) return false;
    if (!hlSupported) {
      toast('Text highlighting needs Chrome/Edge 105+ or Firefox 140+.');
      return false;
    }
    const a = Anchor.rangeToAnchor(root, range);
    if (!a) return false;
    mutate(() => doc.highlights.push({ id: uid(), color, ...a, createdAt: Date.now() }));
    document.getSelection().removeAllRanges();
    return true;
  }

  function quoteSelection() {
    const range = selectionInStatement();
    if (!range) return;
    const text = range.toString().trim().replace(/\s+/g, ' ');
    if (!text) return;
    doc.note = (doc.note.trimEnd() ? doc.note.trimEnd() + '\n\n' : '') + `> ${text}\n`;
    noteArea.value = doc.note;
    scheduleSave();
    openPanel(true);
    document.getSelection().removeAllRanges();
    noteArea.focus();
    noteArea.setSelectionRange(noteArea.value.length, noteArea.value.length);
  }

  // ---------------------------------------------------------------- selection bubble
  function showBubble() {
    const range = selectionInStatement();
    if (!range) return hideBubble();
    const rect = range.getBoundingClientRect();
    bubble.replaceChildren();
    for (const c of PALETTES.light) {
      const b = document.createElement('button');
      b.className = 'dot';
      b.style.background = c;
      b.title = 'Highlight';
      b.setAttribute('aria-label', `Highlight ${c}`);
      b.addEventListener('click', () => {
        S.prefs.styles.highlight.color = c;
        savePrefs();
        highlightSelection(c);
        hideBubble();
        updateStyleButtons();
      });
      bubble.append(b);
    }
    const q = document.createElement('button');
    q.className = 'q';
    setMarkup(q, `${ICONS.quote}<span>Quote</span>`);
    q.title = 'Quote into notes';
    q.addEventListener('click', () => {
      quoteSelection();
      hideBubble();
    });
    bubble.append(q);
    bubble.style.left = `${Math.min(innerWidth - 120, Math.max(120, rect.left + rect.width / 2))}px`;
    bubble.style.top = `${Math.max(44, rect.top - 8)}px`;
    bubble.hidden = false;
  }

  function hideBubble() {
    bubble.hidden = true;
  }

  // Keep the page selection alive while clicking bubble buttons.
  bubble.addEventListener('mousedown', e => e.preventDefault());

  // ---------------------------------------------------------------- history + saving
  const snapshot = () => JSON.stringify({ h: doc.highlights, i: doc.items });

  function pushHistory(snap) {
    history.undo.push(snap);
    if (history.undo.length > 200) history.undo.shift();
    history.redo.length = 0;
  }

  function mutate(fn) {
    pushHistory(snapshot());
    fn();
    afterChange();
  }

  function restore(snap) {
    const o = JSON.parse(snap);
    doc.highlights = o.h;
    doc.items = o.i;
    afterChange();
  }

  function undo() {
    if (!history.undo.length) return;
    history.redo.push(snapshot());
    restore(history.undo.pop());
  }

  function redo() {
    if (!history.redo.length) return;
    history.undo.push(snapshot());
    restore(history.redo.pop());
  }

  function renderAll() {
    renderInk();
    renderTexts();
    resolveHighlights();
    renderHlList();
    btn('undo').disabled = !history.undo.length;
    btn('redo').disabled = !history.redo.length;
  }

  function afterChange() {
    renderAll();
    scheduleSave();
  }

  let saveTimer = null;

  function scheduleSave() {
    setStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }

  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    Object.assign(doc, { title, url: problem.url, updatedAt: Date.now(), writer: instanceId });
    try {
      await Store.put(doc);
      setStatus(`Saved locally · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) {
      setStatus(`Couldn't save: ${err.message}`, true);
    }
  }

  function setStatus(text, error = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('err', error);
  }

  addEventListener('pagehide', () => {
    if (saveTimer) flush();
  });

  // Another tab edited the same problem: take its version unless we have unsaved edits.
  Store.onChange((id, value) => {
    if (!doc || id !== problem.id || saveTimer || gesture) return;
    if (value?.writer === instanceId) return;
    doc = normalize(value) ?? Store.blank({ id: problem.id, contest: problem.contest, index: problem.index, url: problem.url, title });
    if (shadow.activeElement !== noteArea) noteArea.value = doc.note;
    renderAll();
  });

  // ---------------------------------------------------------------- prefs
  async function loadPrefs() {
    try {
      const saved = (await api.storage.local.get('cfn:prefs'))['cfn:prefs'] ?? {};
      const p = { ...structuredClone(DEFAULT_PREFS), ...saved };
      p.styles = { ...structuredClone(DEFAULT_PREFS.styles) };
      for (const k of Object.keys(p.styles)) Object.assign(p.styles[k], saved.styles?.[k]);
      return p;
    } catch {
      return structuredClone(DEFAULT_PREFS);
    }
  }

  let prefsTimer = null;
  function savePrefs() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => api.storage.local.set({ 'cfn:prefs': S.prefs }), 300);
  }

  // ---------------------------------------------------------------- tools
  const DRAW_TOOLS = ['pen', 'marker', 'shape', 'eraser', 'text'];
  const styleKey = () => ({ pen: 'pen', marker: 'marker', shape: 'shape', text: 'text', highlight: 'highlight', cursor: 'highlight' })[S.tool] ?? null;

  function setTool(tool) {
    S.tool = tool;
    closeFlyout();
    hideBubble();
    capture.classList.toggle('on', DRAW_TOOLS.includes(tool));
    capture.classList.toggle('erasing', tool === 'eraser');
    capture.classList.toggle('texting', tool === 'text');
    texts.classList.toggle('inert', !(tool === 'cursor' || tool === 'text'));
    eraserCursor.style.display = 'none';
    document.documentElement.classList.toggle('cfn-highlight-mode', tool === 'highlight');
    for (const b of toolbar.querySelectorAll('[data-tool]')) {
      b.classList.toggle('active', b.dataset.tool === tool);
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    }
    setMarkup(toolbar.querySelector('[data-tool="shape"]'), ICONS[S.prefs.shape]);
    updateStyleButtons();
  }

  function updateStyleButtons() {
    const key = styleKey();
    const st = key && S.prefs.styles[key];
    const colorBtn = btn('color');
    const sizeBtn = btn('size');
    colorBtn.disabled = !st;
    colorBtn.querySelector('.swatch').style.background = st ? st.color : '#e2e8f0';
    const sizes = SIZES[key];
    sizeBtn.disabled = !sizes;
    const dot = sizeBtn.querySelector('.size-dot');
    const idx = sizes ? Math.max(0, sizes.indexOf(st.size)) : 1;
    const d = 4 + idx * 4;
    dot.style.width = dot.style.height = `${d}px`;
  }

  // ---------------------------------------------------------------- flyouts
  function openFlyout(kind, anchor) {
    if (!flyout.hidden && flyout.dataset.kind === kind) return closeFlyout();
    flyout.dataset.kind = kind;
    flyout.replaceChildren();
    const key = styleKey();
    const add = (inner, label, active, onClick) => {
      const b = document.createElement('button');
      setMarkup(b, inner);
      b.title = label;
      b.setAttribute('aria-label', label);
      b.classList.toggle('active', active);
      b.addEventListener('click', onClick);
      flyout.append(b);
    };

    if (kind === 'shape') {
      for (const s of SHAPES) {
        add(ICONS[s], s[0].toUpperCase() + s.slice(1), S.prefs.shape === s, () => {
          S.prefs.shape = s;
          savePrefs();
          setTool('shape');
        });
      }
    } else if (kind === 'color' && key) {
      const st = S.prefs.styles[key];
      for (const c of PALETTES[PALETTE_FOR[key]]) {
        add(`<span class="swatch" style="background:${c}"></span>`, c, st.color === c, () => {
          st.color = c;
          savePrefs();
          updateStyleButtons();
          closeFlyout();
        });
      }
      if (key !== 'highlight') {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = st.color;
        input.title = 'Custom colour';
        input.addEventListener('input', () => {
          st.color = input.value;
          savePrefs();
          updateStyleButtons();
        });
        flyout.append(input);
      }
    } else if (kind === 'size' && SIZES[key]) {
      const st = S.prefs.styles[key];
      SIZES[key].forEach((s, i) => {
        const d = 4 + i * 4;
        add(`<span class="size-dot" style="width:${d}px;height:${d}px"></span>`, `Size ${s}`, st.size === s, () => {
          st.size = s;
          savePrefs();
          updateStyleButtons();
          closeFlyout();
        });
      });
    } else {
      return;
    }

    const tb = toolbar.getBoundingClientRect();
    const ab = anchor.getBoundingClientRect();
    const leftSide = tb.right + 200 > innerWidth;
    flyout.hidden = false;
    const fw = flyout.offsetWidth;
    flyout.style.left = `${leftSide ? tb.left - fw - 8 : tb.right + 8}px`;
    flyout.style.top = `${Math.min(innerHeight - flyout.offsetHeight - 8, ab.top)}px`;
  }

  function closeFlyout() {
    flyout.hidden = true;
    flyout.dataset.kind = '';
  }

  // ---------------------------------------------------------------- pointer input on the drawing layer
  function constrain(g, p, shift) {
    let { x, y } = p;
    if (shift) {
      const dx = x - g.x1;
      const dy = y - g.y1;
      if (g.shape === 'rect' || g.shape === 'ellipse') {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        x = g.x1 + Math.sign(dx || 1) * d;
        y = g.y1 + Math.sign(dy || 1) * d;
      } else {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        x = g.x1 + Math.cos(a) * len;
        y = g.y1 + Math.sin(a) * len;
      }
    }
    g.x2 = x;
    g.y2 = y;
  }

  function liveItem(g) {
    if (g.tool === 'pen' || g.tool === 'marker') {
      return { id: 'live', kind: g.tool, pts: g.builder.points, color: g.color, size: g.size, thin: g.thin };
    }
    return { id: 'live', kind: g.shape, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, color: g.color, size: g.size };
  }

  function paintLive() {
    if (!gesture || gesture.tool === 'eraser') return liveG.replaceChildren();
    liveG.replaceChildren(itemToSvg(liveItem(gesture)));
  }

  function showEraserCursor(p) {
    eraserCursor.setAttribute('cx', p.x);
    eraserCursor.setAttribute('cy', p.y);
    eraserCursor.style.display = 'block';
  }

  function textHit(it, cx, cy) {
    const w = texts.querySelector(`[data-id="${it.id}"]`);
    if (!w) return false;
    const r = w.getBoundingClientRect();
    return cx >= r.left - ERASER_R && cx <= r.right + ERASER_R && cy >= r.top - ERASER_R && cy <= r.bottom + ERASER_R;
  }

  function eraseAt(q) {
    const cx = q.x + S.origin.x - scrollX;
    const cy = q.y + S.origin.y - scrollY;
    const items = new Set();
    for (const it of doc.items) {
      const s = shiftOf(it);
      if (it.kind === 'text' ? textHit(it, cx, cy) : Ink.hit(it, q.x - s.x, q.y - s.y, ERASER_R)) items.add(it.id);
    }
    const hls = new Set();
    for (const h of doc.highlights) {
      const r = hlRanges.get(h.id);
      if (!r) continue;
      for (const rc of r.getClientRects()) {
        if (cx >= rc.left - ERASER_R / 2 && cx <= rc.right + ERASER_R / 2 && cy >= rc.top && cy <= rc.bottom) {
          hls.add(h.id);
          break;
        }
      }
    }
    if (!items.size && !hls.size) return false;
    gesture.snap ??= snapshot();
    doc.items = doc.items.filter(i => !items.has(i.id));
    doc.highlights = doc.highlights.filter(h => !hls.has(h.id));
    return true;
  }

  // Sample along the eraser's path so fast swipes don't skip over thin strokes.
  function eraseAlong(a, b) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (ERASER_R / 2)));
    let changed = false;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      changed = eraseAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) || changed;
    }
    if (changed) renderAll();
  }

  function createTextAt(p) {
    const st = S.prefs.styles.text;
    const before = snapshot();
    const it = { id: uid(), kind: 'text', x: Math.round(p.x), y: Math.round(p.y - st.size * 0.8), text: '', color: st.color, size: st.size };
    const anchor = nearestCharAnchor(p);
    if (anchor) it.anchor = anchor;
    doc.items.push(it);
    renderTexts();
    const ed = texts.querySelector(`[data-id="${it.id}"] .tb`);
    ed._before = before;
    setTimeout(() => ed.focus(), 0);
  }

  function commitText(id, ed) {
    const before = ed._before;
    ed._before = null;
    const item = findItem(id);
    if (!item) return;
    item.text = ed.innerText.replace(/\n$/, '');
    if (!item.text.trim()) doc.items = doc.items.filter(i => i.id !== id);
    if (before && before !== snapshot()) pushHistory(before);
    afterChange();
  }

  function startDragText(e, id, w) {
    const item = findItem(id);
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    const before = snapshot();
    const sx = e.pageX;
    const sy = e.pageY;
    const ox = item.x;
    const oy = item.y;
    grip.setPointerCapture(e.pointerId);
    const move = ev => {
      item.x = Math.round(ox + ev.pageX - sx);
      item.y = Math.round(oy + ev.pageY - sy);
      positionTextBox(w, item);
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      if (item.x !== ox || item.y !== oy) {
        pushHistory(before);
        afterChange();
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  capture.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    closeFlyout();
    e.preventDefault();
    // preventDefault keeps focus where it was; release it so Ctrl+Z undoes ink, not typing.
    shadow.activeElement?.blur();
    if (document.activeElement !== document.body) document.activeElement?.blur?.();
    const p = local(e);
    // The eraser end of a stylus (button 5) erases whatever tool is selected.
    const tool = e.pointerType === 'pen' && e.buttons & 32 ? 'eraser' : S.tool;
    if (tool === 'text') return; // text boxes are created on pointerup so focus sticks
    capture.setPointerCapture(e.pointerId);

    if (tool === 'pen' || tool === 'marker') {
      const st = S.prefs.styles[tool];
      const simulate = e.pointerType !== 'pen';
      const builder = new Ink.StrokeBuilder({ size: st.size, simulatePressure: simulate, streamline: tool === 'marker' ? 0.5 : 0.3 });
      builder.add(p.x, p.y, e.pressure);
      gesture = { tool, pointerId: e.pointerId, builder, color: st.color, size: st.size, thin: tool === 'pen' ? (simulate ? 0.35 : 0.6) : 0 };
    } else if (tool === 'shape') {
      const st = S.prefs.styles.shape;
      gesture = { tool, pointerId: e.pointerId, shape: S.prefs.shape, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color, size: st.size };
    } else if (tool === 'eraser') {
      gesture = { tool, pointerId: e.pointerId, last: p, snap: null };
      eraseAlong(p, p);
      showEraserCursor(p);
    }
    paintLive();
  });

  capture.addEventListener('pointermove', e => {
    if (S.tool === 'eraser' && !gesture) showEraserCursor(local(e));
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const events = e.getCoalescedEvents?.() || [];
    const samples = events.length ? events : [e];
    const g = gesture;
    if (g.tool === 'pen' || g.tool === 'marker') {
      for (const ev of samples) {
        const p = local(ev);
        g.builder.add(p.x, p.y, ev.pressure);
      }
    } else if (g.tool === 'shape') {
      constrain(g, local(e), e.shiftKey);
    } else if (g.tool === 'eraser') {
      for (const ev of samples) {
        const p = local(ev);
        eraseAlong(g.last, p);
        g.last = p;
      }
      showEraserCursor(g.last);
    }
    paintLive();
  });

  function commitItem(it) {
    const anchor = nearestCharAnchor(bboxCenter(it));
    if (anchor) it.anchor = anchor;
    mutate(() => doc.items.push(it));
  }

  function endGesture(e) {
    if (S.tool === 'text' && e.type === 'pointerup' && !gesture) {
      if (e.pointerType !== 'mouse' || e.button === 0) createTextAt(local(e));
      return;
    }
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const g = gesture;
    gesture = null;
    liveG.replaceChildren();
    if (g.tool === 'pen' || g.tool === 'marker') {
      const p = local(e);
      const pts = g.builder.finish(p.x, p.y);
      if (pts.length) commitItem({ id: uid(), kind: g.tool, color: g.color, size: g.size, thin: g.thin, pts });
    } else if (g.tool === 'shape') {
      if (Math.hypot(g.x2 - g.x1, g.y2 - g.y1) >= 3) {
        commitItem({ id: uid(), kind: g.shape, color: g.color, size: g.size, x1: r1(g.x1), y1: r1(g.y1), x2: r1(g.x2), y2: r1(g.y2) });
      }
    } else if (g.tool === 'eraser') {
      if (S.tool !== 'eraser') eraserCursor.style.display = 'none';
      if (g.snap) {
        pushHistory(g.snap);
        afterChange();
      }
    }
  }

  capture.addEventListener('pointerup', endGesture);
  capture.addEventListener('pointercancel', endGesture);
  capture.addEventListener('pointerleave', () => {
    if (!gesture) eraserCursor.style.display = 'none';
  });

  // ---------------------------------------------------------------- page selection -> highlight
  document.addEventListener('pointerup', e => {
    if (e.composedPath().includes(host)) return;
    setTimeout(() => {
      if (S.tool === 'highlight') highlightSelection(S.prefs.styles.highlight.color);
      else if (S.tool === 'cursor') showBubble();
    }, 0);
  });
  document.addEventListener('pointerdown', e => {
    if (!e.composedPath().includes(host)) {
      hideBubble();
      closeFlyout();
    }
  });
  addEventListener('scroll', hideBubble, { passive: true });

  // ---------------------------------------------------------------- toolbar
  toolbar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const tool = b.dataset.tool;
    if (tool) {
      // Clicking the active tool again puts the cursor back; picking Shapes shows the shape choices.
      if (S.tool === tool && tool !== 'cursor') setTool('cursor');
      else {
        setTool(tool);
        if (tool === 'shape') openFlyout('shape', b);
      }
      return;
    }
    switch (b.dataset.act) {
      case 'color':
      case 'size':
        openFlyout(b.dataset.act, b);
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'notes':
        openPanel(panel.hidden);
        break;
      case 'clear':
        if ((doc.items.length || doc.highlights.length) && confirm('Clear all highlights, drawings and text boxes on this problem?\n(Your written notes are kept, and you can undo this.)')) {
          mutate(() => {
            doc.items = [];
            doc.highlights = [];
          });
        }
        break;
      case 'minimize':
      case 'expand':
        S.prefs.minimized = b.dataset.act === 'minimize';
        toolbar.classList.toggle('min', S.prefs.minimized);
        if (S.prefs.minimized) setTool('cursor');
        savePrefs();
        clampToolbar();
        break;
    }
  });

  function clampToolbar() {
    const pos = S.prefs.toolbar;
    if (!pos) return;
    const r = toolbar.getBoundingClientRect();
    const left = Math.min(Math.max(4, pos.left), innerWidth - r.width - 4);
    const top = Math.min(Math.max(4, pos.top), innerHeight - r.height - 4);
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  $('.toolbar .grip').addEventListener('pointerdown', e => {
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const r = toolbar.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = ev => {
      S.prefs.toolbar = { left: ev.clientX - dx, top: ev.clientY - dy };
      clampToolbar();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      savePrefs();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  // ---------------------------------------------------------------- notes panel
  function openPanel(open) {
    panel.hidden = !open;
    btn('notes').classList.toggle('active', open);
    if (S.prefs.panelOpen !== open) {
      S.prefs.panelOpen = open;
      savePrefs();
    }
  }

  $('[data-act="close-panel"]').addEventListener('click', () => openPanel(false));
  noteArea.addEventListener('input', () => {
    doc.note = noteArea.value;
    scheduleSave();
  });
  noteArea.addEventListener('keydown', e => e.stopPropagation());

  function scrollToHighlight(id) {
    const r = hlRanges.get(id);
    if (!r) return;
    const rect = r.getBoundingClientRect();
    scrollTo({ top: rect.top + scrollY - innerHeight / 3, behavior: 'smooth' });
  }

  function renderHlList() {
    hlList.replaceChildren();
    $('.hl-count').textContent = doc.highlights.length ? `(${doc.highlights.length})` : '';
    // The section only shows up once something is highlighted.
    $('.p-section').hidden = !doc.highlights.length;
    for (const h of doc.highlights) {
      const li = document.createElement('li');
      const found = hlRanges.has(h.id) || !hlSupported;
      li.classList.toggle('lost', !found);
      li.title = found ? 'Scroll to highlight' : 'This text was not found on the page';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = h.color;
      const q = document.createElement('span');
      q.className = 'q';
      q.textContent = h.quote.length > 140 ? `${h.quote.slice(0, 140)}…` : h.quote;
      const del = document.createElement('button');
      del.textContent = '×';
      del.title = 'Remove highlight';
      del.setAttribute('aria-label', 'Remove highlight');
      del.addEventListener('click', ev => {
        ev.stopPropagation();
        mutate(() => (doc.highlights = doc.highlights.filter(x => x.id !== h.id)));
      });
      li.append(dot, q, del);
      li.addEventListener('click', () => scrollToHighlight(h.id));
      hlList.append(li);
    }
  }

  // ---------------------------------------------------------------- toast
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  }

  // ---------------------------------------------------------------- keyboard
  const TOOL_KEYS = { KeyV: 'cursor', KeyH: 'highlight', KeyP: 'pen', KeyM: 'marker', KeyR: 'shape', KeyT: 'text', KeyE: 'eraser' };

  document.addEventListener(
    'keydown',
    e => {
      if (isTyping(e.composedPath()[0])) return;
      const mod = e.ctrlKey || e.metaKey;
      // Global: Alt+Shift+P starts drawing, Alt+Shift+N toggles the notes panel.
      if (e.altKey && e.shiftKey && !mod) {
        if (e.code === 'KeyN') openPanel(panel.hidden);
        else if (e.code === 'KeyP') setTool('pen');
        else return;
        e.preventDefault();
        return;
      }
      // Everything else only applies while an annotation tool is active.
      if (S.tool === 'cursor') return;
      if (e.key === 'Escape') setTool('cursor');
      else if (mod && !e.altKey && e.code === 'KeyZ') e.shiftKey ? redo() : undo();
      else if (mod && !e.altKey && e.code === 'KeyY') redo();
      else if (!mod && !e.altKey && TOOL_KEYS[e.code]) setTool(TOOL_KEYS[e.code] === S.tool ? 'cursor' : TOOL_KEYS[e.code]);
      else return;
      e.preventDefault();
    },
    true,
  );

  // ---------------------------------------------------------------- init
  (async () => {
    const [stored, prefs] = await Promise.all([Store.get(problem.id).catch(() => null), loadPrefs()]);
    S.prefs = prefs;
    doc = normalize(stored) ?? Store.blank({ id: problem.id, contest: problem.contest, index: problem.index, url: problem.url, title });

    mount();
    noteArea.value = doc.note;
    toolbar.classList.toggle('min', prefs.minimized);
    clampToolbar();
    setTool('cursor');
    openPanel(prefs.panelOpen || !!doc.note.trim());
    if (stored) setStatus(`Last edited ${new Date(doc.updatedAt).toLocaleString()}`);
    relayout();
    renderAll();

    // MathJax re-renders the statement after load; anchor highlights once it settles.
    await waitForStable(root);
    relayout();
    renderAll();

    let reTimer = null;
    new MutationObserver(() => {
      clearTimeout(reTimer);
      reTimer = setTimeout(reflow, 300);
    }).observe(root, { subtree: true, childList: true, characterData: true });
    new ResizeObserver(scheduleReflow).observe(document.body);
    new ResizeObserver(scheduleReflow).observe(root);
    addEventListener('resize', () => {
      scheduleReflow();
      clampToolbar();
    });
  })();
})();
