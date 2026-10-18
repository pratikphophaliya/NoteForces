# NoteForces

A browser extension for annotating Codeforces problems while you solve them. You can highlight the statement, write with a pen, draw shapes, add text boxes and keep written notes. Everything is saved offline on your computer and comes back when you reopen the problem. There's no account and no server.

## Install

### Chrome, Edge, Brave, Opera (any Chromium browser)

1. Go to the [latest release](https://github.com/pratikphophaliya/NoteForces/releases/latest) and download `noteforces-<version>.zip` (under **Assets**).
2. Unzip it into a folder you'll keep. Right-click the zip → **Extract All…**, and pick a place like `Documents/NoteForces`. Don't delete this folder later, because the browser loads the extension from it.
3. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Opera: `opera://extensions`
4. Turn on **Developer mode** (a toggle in the top-right corner, or on the left side in Edge).
5. Click **Load unpacked** and select the unzipped folder: the one that has `manifest.json` directly inside it.
6. Open any Codeforces problem, e.g. <https://codeforces.com/problemset/problem/4/A>. The NoteForces toolbar appears on the left. Pin the extension icon if you want quick access to your notes list.

**Updating to a new version:** download the new zip and unzip it **into the same folder**, replacing the old files. Then click the ⟳ reload button on NoteForces in the extensions page. Your notes are kept.

> Don't click **Remove** on the extension when updating. Removing it deletes the notes saved in that browser. Use **Settings → Export all notes** first if you ever need to reinstall.

### Firefox (140+)

Firefox only keeps add-ons installed permanently when they come from Firefox Add-ons (AMO). To try a release zip in the meantime:

1. Download and unzip the release as above.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick the `manifest.json` file inside the unzipped folder.

A temporary add-on is removed when Firefox closes, along with its notes, so export your notes before closing.

### From source (for development)

Clone this repo and use **Load unpacked** on the repo folder (Chromium), or **Load Temporary Add-on** with its `manifest.json` (Firefox).

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
- **Drawings are SVG vectors**, each pinned to the nearest character of the statement. They stay sharp at any zoom, take little storage, and move with the text when it rewraps.
- **Highlights use the CSS Custom Highlight API.** The page's HTML is never modified, so MathJax and Codeforces scripts can't break, and nothing breaks them. Each highlight is stored as character offsets plus the quoted text and some surrounding context. If the statement shifts, the highlight finds its text again.
- **Problem IDs are shared** between `/problemset/problem/4/A` and `/contest/4/problem/A`, so notes follow the problem. Gym and group problems get a `gym` prefix.
- **Autosave** runs 0.4 s after each change and again when the tab closes. If the same problem is open in two tabs, they stay in sync.
