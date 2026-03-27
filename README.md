# ChaosEdit

Lightweight Electron editor extracted from the Monaco workspace panel used in the CMS companion app.

## Structure

- `main.js`: Electron main process, workspace file IPC, Monaco asset server
- `preload.cjs`: Safe renderer API bridge
- `app.html`: UI layout + styles
- `app.js`: Renderer logic (file tree, Monaco, save/create/delete, theme, console)
- `vendor/powerglitch.min.js`: local animation dependency used by About modal

## Run (Current Monorepo)

From repo root:

```bash
npm run editor:app
```

Build from repo root:

```bash
npm run editor:app:portable
npm run editor:app:installer
```

## Run (As Standalone Repo)

From `standalone-editor/`:

```bash
npm install
npm run start
```

Build standalone:

```bash
npm run build:portable
npm run build:installer
```

## Publish This Folder As Its Own GitHub Repo

You can keep this folder inside the parent repo and still publish it separately with `git subtree`.

From parent repo root:

```bash
git subtree split --prefix=standalone-editor -b chaosedit-publish
git push git@github.com:<your-user>/<your-chaosedit-repo>.git chaosedit-publish:main
```

Then you can keep updating and republishing with the same commands.
