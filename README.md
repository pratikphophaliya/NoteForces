# NoteForces

A browser extension for annotating Codeforces problems while you solve them. You can highlight the statement, write with a pen, draw shapes, add text boxes and keep written notes. Everything is saved offline on your computer and comes back when you reopen the problem. There's no account and no server.

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Open any problem, e.g. <https://codeforces.com/problemset/problem/4/A>. The toolbar appears on the left.

Firefox (140+): open `about:debugging` → *This Firefox* → *Load Temporary Add-on* → pick `manifest.json`.

## How to use

| Tool | What it does | Key* |
|---|---|---|
| Cursor | Normal page. Selecting statement text pops up colour dots (highlight) and **Quote** (copy into your notes) | Esc |
| Highlight text | Any text you select is highlighted right away | H |
| Pen | Pressure-sensitive ink (uses stylus pressure; with a mouse, writing faster makes the line thinner) | P |
| Highlighter ink | Wide see-through marker that you draw freehand | M |
| Shapes | Rectangle, ellipse, line, arrow, chosen from the menu that opens; hold **Shift** for a square/circle or 45° lines | R |
| Text box | Click anywhere to type. Drag the ⋮⋮ grip to move it | T |
| Eraser | Erases whole strokes, shapes, text boxes and highlights. The eraser end of a stylus works with any tool | E |

\*Single-letter keys work while a tool is active. Anywhere on the page: **Alt+Shift+P** starts the pen and **Alt+Shift+N** opens the notes panel. **Ctrl+Z / Ctrl+Y** undo and redo.

Clicking the active tool again (or pressing its key again) switches back to the cursor. Choosing Shapes shows the shape choices. Colour and size are the two buttons under the tools. The toolbar can be dragged and minimised.

Drawings and text boxes are **pinned to the nearest character of the statement**. When you resize the window or zoom and the text rewraps, they move with the text.

The **popup** (extension icon) lists every problem you've annotated, with search. **Settings → Notes folder** mirrors all notes into a folder you choose. It writes `problems/<id>.json` (restorable) and `notes/<id>.md` (readable without the extension). Export/Import gives you a single backup file.

## Where your notes are stored

- **Main store:** `chrome.storage.local`, inside your browser profile on this laptop. It works fully offline and needs no login. `unlimitedStorage` is enabled, so there's no 10 MB cap.
- **Your own folder (optional):** a browser extension isn't allowed to write to an arbitrary folder on its own. So you pick the folder once in Settings, and the browser remembers it. The folder is refreshed every time you open the popup or press *Back up now*. Firefox doesn't support this, so use Export there.

## How it works

```
manifest.json            MV3; content script runs only on problem pages
src/shared/storage.js    one record per problem: cfn:problem:<id>  (e.g. 1900A, gym104114B)
src/shared/folder.js     File System Access backup to a folder (JSON + Markdown)
src/content/anchor.js    highlight anchoring: text offsets + quote + context, survives MathJax re-renders
src/content/ink.js       ink engine: smoothing, pressure, variable-width outline, shapes, eraser hit-tests
src/content/ui.js        toolbar / panel markup and CSS (Shadow DOM, isolated from Codeforces CSS)
src/content/main.js      tools, undo/redo, autosave, rendering, notes panel, cross-tab sync
src/popup/               list + search of all annotated problems
src/options/             notes folder, export/import, delete
```

Design choices:
- **Drawings are SVG vectors**, anchored to the top-left of the problem statement. They stay sharp at any zoom, take little storage, and stay aligned when the header or ads change size.
- **Highlights use the CSS Custom Highlight API.** The page's HTML is never modified, so MathJax and Codeforces scripts can't break, and nothing breaks them. Each highlight is stored as character offsets plus the quoted text and some surrounding context. If the statement shifts, the highlight finds its text again.
- **Problem IDs are shared** between `/problemset/problem/4/A` and `/contest/4/problem/A`, so notes follow the problem. Gym and group problems get a `gym` prefix.
- **Autosave** runs 0.4 s after each change and again when the tab closes. If the same problem is open in two tabs, they stay in sync.

## Ideas for later

1. **Ink to shape:** draw a rough box or circle, pause, and it snaps into a clean shape (like OneNote).
2. **Lasso select:** move or recolour or delete groups of strokes, plus a "move" tool for shapes.
3. **Tags and status** per problem (Solved / WA / Revisit, plus a topic like dp or graphs), shown in the popup with filters. The rating and tags could be pulled from the public Codeforces API.
4. **Markdown + LaTeX preview** in the notes panel, and code-snippet blocks.
5. **Notes on the submit/status pages:** link a submission ID to a note ("WA on test 5 because of overflow").
6. **Revisit reminders:** spaced repetition for problems marked "Revisit".
7. **Auto-backup on every save** through an offscreen document, so the folder is always current without opening the popup.
8. **A single sidebar overview** of all your notes, plus a "random problem I struggled with" button.
9. **Dark mode** that matches Codeforces dark themes and extensions.
10. **Templates** for notes (Observations / Approach / Complexity / Edge cases).
