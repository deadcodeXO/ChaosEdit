# ChaosEdit

ChaosEdit is a local-first desktop text editor built with Electron and Monaco.

It is designed for quick workspace editing with a focused UI: file tree, Monaco code view, inline status/console, and safe workspace-scoped file operations.

## Highlights

- Workspace-based editing for local folders
- Monaco editor with syntax mode selection by file extension
- File actions: open, create, save, save as, delete
- Dirty-state tracking with unsaved-change prompts
- Folder/file filter and expandable file tree
- Light/dark theme toggle
- Built-in console panel for editor/runtime logs
- Frameless custom titlebar with custom window controls
- About modal with runtime metadata and animation effects

## Safety And Limits

ChaosEdit intentionally limits risky or heavy operations:

- File operations are constrained to the active workspace root
- Path traversal outside workspace is blocked
- Workspace listing limit: `5000` files
- Several large/system directories are skipped (`.git`, `node_modules`, `dist`, `.next`, etc.)
- Common lockfiles are skipped in tree listing
- Known binary-like extensions are blocked from in-editor writes

## Keyboard Shortcuts

- `Ctrl/Cmd + S`: Save
- `Ctrl/Cmd + Shift + S`: Save As
- `Ctrl/Cmd + F`: Focus file filter
- `Ctrl/Cmd + O`: Open workspace folder
- `Ctrl/Cmd + Shift + L`: Toggle console panel
- `Esc`: Close open modal dialogs

## Project Structure

- `main.js`: Electron main process, workspace/file IPC handlers, Monaco asset server
- `preload.cjs`: Renderer-safe API bridge (`window.electronAPI`)
- `app.html`: App layout and UI styling
- `app.js`: Renderer logic (state, Monaco loading, file tree, actions, shortcuts)
- `vendor/powerglitch.min.js`: About modal glitch animation dependency

## Run

From `standalone-editor/`:

```bash
npm install
npm run editor:app
```

`npm start` runs the same command.

## Build (Windows)

From `standalone-editor/`:

```bash
npm run editor:app:portable
npm run editor:app:installer
```

- Portable build output: `release/`
- Installer build output: `release-installer/`

## Monaco Loading Strategy

At startup, ChaosEdit attempts to serve Monaco assets from a local HTTP server (loopback only). If unavailable, it falls back to jsDelivr CDN for Monaco AMD assets.
