// Markup, styles and icons for the in-page UI. Everything lives in a Shadow DOM so
// Codeforces' CSS can't leak in (and ours can't leak out).
(() => {
  const I = d =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  const ICONS = {
    cursor: I('<path d="M5 3l6.5 17 2.4-7.1L21 10.5z"/>'),
    highlight: I('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
    pen: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    marker: I('<path d="M4 18c3-1 5-8 9-9s4 5 7 4" stroke-width="5" opacity=".55"/>'),
    rect: I('<rect x="4" y="5" width="16" height="14" rx="1.5"/>'),
    ellipse: I('<ellipse cx="12" cy="12" rx="9" ry="7"/>'),
    line: I('<path d="M5 19 19 5"/>'),
    arrow: I('<path d="M5 19 19 5"/><path d="M10 5h9v9"/>'),
    text: I('<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>'),
    eraser: I('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
    undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    redo: I('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    notes: I('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>'),
    trash: I('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/>'),
    minimize: I('<path d="m15 18-6-6 6-6"/>'),
    grip: '<svg viewBox="0 0 12 18" width="10" height="14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="9" r="1.4"/><circle cx="9" cy="9" r="1.4"/><circle cx="3" cy="15" r="1.4"/><circle cx="9" cy="15" r="1.4"/></svg>',
    quote: I('<path d="M3 21c3 0 7-1 7-8V5H3v7h4c0 4-1 6-4 6z"/><path d="M14 21c3 0 7-1 7-8V5h-7v7h4c0 4-1 6-4 6z"/>'),
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { all: unset; box-sizing: border-box; }

    /* ---- drawing layers ---- */
    .ink { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
    .eraser-cursor { fill: rgba(255,255,255,.35); stroke: #334155; stroke-width: 1; display: none; }
    .capture { position: fixed; inset: 0; pointer-events: none; touch-action: none; }
    .capture.on { pointer-events: auto; cursor: crosshair; }
    .capture.erasing { cursor: none; }
    .capture.texting { cursor: text; }

    /* ---- text boxes ---- */
    .texts { position: absolute; left: 0; top: 0; width: 0; height: 0; }
    .tbw { position: absolute; width: max-content; max-width: 460px; pointer-events: auto; }
    .texts.inert .tbw { pointer-events: none; }
    .tb {
      display: block; min-width: 28px; max-width: 440px; padding: 2px 6px; margin: 0;
      font: 16px/1.4 "Segoe UI", system-ui, -apple-system, sans-serif;
      white-space: pre-wrap; overflow-wrap: anywhere; outline: none; cursor: text;
      border: 1px dashed transparent; border-radius: 4px;
    }
    .tbw:hover .tb, .tb:focus { border-color: #93c5fd; background: rgba(255,255,255,.92); }
    .tb:empty::before { content: "Type a note…"; color: #94a3b8; }
    .grip-t {
      position: absolute; left: -14px; top: 3px; width: 12px; height: 18px; display: grid; place-items: center;
      cursor: move; color: #64748b; opacity: 0; touch-action: none;
    }
    .tbw:hover .grip-t { opacity: 1; }

    /* ---- toolbar ---- */
    .toolbar {
      position: fixed; left: 12px; top: 140px; display: flex; flex-direction: column; gap: 2px; padding: 6px;
      background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
      box-shadow: 0 6px 24px rgba(15,23,42,.14); pointer-events: auto;
      font: 13px/1.3 "Segoe UI", system-ui, sans-serif; color: #334155; user-select: none;
    }
    .toolbar button, .flyout button {
      width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; color: #334155; cursor: pointer;
    }
    .toolbar button:hover, .flyout button:hover { background: #f1f5f9; }
    .toolbar button.active { background: #dbeafe; color: #1d4ed8; }
    .toolbar button:disabled { opacity: .3; cursor: default; background: none; }
    .toolbar button:focus-visible, .flyout button:focus-visible, .panel button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
    .toolbar .sep { height: 1px; background: #e2e8f0; margin: 3px 4px; }
    .toolbar .grip { height: 14px; display: grid; place-items: center; cursor: grab; color: #94a3b8; touch-action: none; }
    .toolbar.min > :not(.grip):not([data-act="expand"]) { display: none; }
    .toolbar:not(.min) [data-act="expand"] { display: none; }
    .swatch { width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(15,23,42,.25); }
    .size-dot { border-radius: 50%; background: #334155; }

    /* ---- flyout (shapes / colours / sizes) ---- */
    .flyout {
      position: fixed; display: flex; flex-wrap: wrap; gap: 4px; padding: 6px; max-width: 180px;
      background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 6px 24px rgba(15,23,42,.14);
      pointer-events: auto; font: 12px "Segoe UI", system-ui, sans-serif; color: #334155;
    }
    .flyout[hidden] { display: none; }
    .flyout button.active { background: #dbeafe; color: #1d4ed8; }
    .flyout input[type=color] { width: 34px; height: 34px; padding: 0; border: none; background: none; cursor: pointer; }

    /* ---- selection bubble ---- */
    .bubble {
      position: fixed; display: flex; align-items: center; gap: 4px; padding: 5px 6px;
      background: #1e293b; border-radius: 999px; box-shadow: 0 6px 20px rgba(15,23,42,.3);
      pointer-events: auto; transform: translate(-50%, -100%);
    }
    .bubble[hidden] { display: none; }
    .bubble button { width: 22px; height: 22px; border-radius: 50%; cursor: pointer; display: grid; place-items: center; }
    .bubble button.dot { box-shadow: inset 0 0 0 2px rgba(255,255,255,.25); }
    .bubble button.dot:hover { transform: scale(1.15); }
    .bubble button.q { width: auto; padding: 0 8px; color: #e2e8f0; font: 12px "Segoe UI", system-ui, sans-serif; gap: 4px; display: flex; border-radius: 999px; }
    .bubble button.q:hover { background: #334155; }
    .bubble button.q svg { width: 13px; height: 13px; }

    /* ---- notes panel ---- */
    .panel {
      position: fixed; right: 16px; top: 80px; width: 330px; max-height: calc(100vh - 100px);
      display: flex; flex-direction: column; gap: 8px; padding: 12px;
      background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 30px rgba(15,23,42,.18);
      pointer-events: auto; font: 13px/1.45 "Segoe UI", system-ui, sans-serif; color: #1e293b;
    }
    .panel[hidden] { display: none; }
    .panel header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .p-title { font-weight: 600; font-size: 14px; }
    .p-id { color: #64748b; font-size: 12px; }
    .panel header button { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; cursor: pointer; font-size: 18px; color: #64748b; }
    .panel header button:hover { background: #f1f5f9; }
    .p-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
    .panel textarea {
      width: 100%; min-height: 170px; resize: vertical; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px;
      font: 13px/1.5 ui-monospace, "Cascadia Code", Consolas, monospace; color: #0f172a; background: #f8fafc; outline: none;
    }
    .panel textarea:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 3px rgba(96,165,250,.25); }
    .p-status { font-size: 11px; color: #64748b; min-height: 15px; }
    .p-status.err { color: #b91c1c; }
    .p-section[hidden] { display: none; }
    .p-section { display: flex; flex-direction: column; gap: 6px; min-height: 0; overflow: auto; }
    .hl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .hl-list li { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: 8px; background: #f8fafc; cursor: pointer; }
    .hl-list li:hover { background: #f1f5f9; }
    .hl-list li.lost { opacity: .55; }
    .hl-list .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; }
    .hl-list .q { flex: 1; overflow-wrap: anywhere; }
    .hl-list button { flex: none; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 4px; color: #94a3b8; cursor: pointer; }
    .hl-list button:hover { background: #e2e8f0; color: #b91c1c; }
    .panel footer { font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 6px; }

    .toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px;
      background: #1e293b; color: #f8fafc; font: 13px "Segoe UI", system-ui, sans-serif; pointer-events: none;
    }
    .toast[hidden] { display: none; }
  `;

  const TEMPLATE = `
    <svg class="ink" xmlns="http://www.w3.org/2000/svg">
      <g class="markers"></g><g class="strokes"></g><g class="live"></g>
      <circle class="eraser-cursor" r="10"></circle>
    </svg>
    <div class="capture"></div>
    <div class="texts"></div>
    <div class="toolbar" role="toolbar" aria-label="NoteForces tools" aria-orientation="vertical">
      <div class="grip" title="Drag to move">${ICONS.grip}</div>
      <button data-act="expand" title="Show NoteForces tools">${ICONS.pen}</button>
      <button data-tool="cursor" title="Normal page (Esc)" aria-label="Normal page">${ICONS.cursor}</button>
      <button data-tool="highlight" title="Highlight text (H)" aria-label="Highlight text">${ICONS.highlight}</button>
      <button data-tool="pen" title="Pen (P)" aria-label="Pen">${ICONS.pen}</button>
      <button data-tool="marker" title="Highlighter ink (M)" aria-label="Highlighter ink">${ICONS.marker}</button>
      <button data-tool="shape" title="Shapes (R)" aria-label="Shapes">${ICONS.rect}</button>
      <button data-tool="text" title="Text box (T)" aria-label="Text box">${ICONS.text}</button>
      <button data-tool="eraser" title="Eraser (E)" aria-label="Eraser">${ICONS.eraser}</button>
      <div class="sep"></div>
      <button data-act="color" title="Colour" aria-label="Colour"><span class="swatch"></span></button>
      <button data-act="size" title="Size" aria-label="Size"><span class="size-dot"></span></button>
      <div class="sep"></div>
      <button data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICONS.undo}</button>
      <button data-act="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${ICONS.redo}</button>
      <div class="sep"></div>
      <button data-act="notes" title="Notes panel (Alt+Shift+N)" aria-label="Notes panel">${ICONS.notes}</button>
      <button data-act="clear" title="Clear highlights &amp; drawings on this problem" aria-label="Clear">${ICONS.trash}</button>
      <button data-act="minimize" title="Minimise toolbar" aria-label="Minimise">${ICONS.minimize}</button>
    </div>
    <div class="flyout" hidden></div>
    <div class="bubble" hidden></div>
    <aside class="panel" hidden aria-label="Problem notes">
      <header>
        <div><div class="p-title"></div><div class="p-id"></div></div>
        <button data-act="close-panel" title="Close" aria-label="Close">×</button>
      </header>
      <label class="p-label" for="cfn-note">Notes</label>
      <textarea id="cfn-note" placeholder="Observations, ideas, edge cases, complexity, why WA on test 3…"></textarea>
      <div class="p-status" aria-live="polite"></div>
      <div class="p-section">
        <div class="p-label">Highlights <span class="hl-count"></span></div>
        <ul class="hl-list"></ul>
      </div>
      <footer>Saved offline on this computer · no account needed</footer>
    </aside>
    <div class="toast" hidden role="status"></div>
  `;

  globalThis.CFNUI = { ICONS, CSS, TEMPLATE };
})();
