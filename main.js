import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  mkdir as mkdirAsync,
  readdir as readdirAsync,
  readFile as readFileAsync,
  rename as renameAsync,
  stat as statAsync,
  unlink as unlinkAsync,
  writeFile as writeFileAsync,
} from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bundledProjectRoot = path.resolve(__dirname, "..");

const MONACO_VERSION = "0.53.0";
const MONACO_ASSET_HOST = "127.0.0.1";
const MONACO_ASSET_PORT_START = 4382;
const MONACO_ASSET_PORT_END = 4499;
const MONACO_CDN_AMD_BASE_URL = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
const MAX_WORKSPACE_FILES = 5000;

const WORKSPACE_IGNORED_DIRS = new Set([
  ".git",
  ".astro",
  ".dcx",
  "node_modules",
  "dist",
  "release",
  "release-fresh",
  ".next",
  ".nuxt",
  ".idea",
  ".vscode",
]);

const WORKSPACE_IGNORED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const WORKSPACE_KNOWN_TEXT_EXTENSIONS = new Set([
  ".astro",
  ".md",
  ".md2",
  ".mdx",
  ".markdown",
  ".mdown",
  ".mkd",
  ".txt",
  ".json",
  ".jsonc",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".svg",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
  ".env",
  ".ini",
  ".conf",
  ".gitignore",
  ".prettierignore",
  ".dockerignore",
  ".eslintignore",
  ".editorconfig",
]);

const WORKSPACE_BLOCKED_BINARY_EXTENSIONS = new Set([
  ".a",
  ".7z",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".db",
  ".db3",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".flac",
  ".gif",
  ".gz",
  ".ico",
  ".iso",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lib",
  ".lockb",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".obj",
  ".otf",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".pyc",
  ".rar",
  ".so",
  ".sqlite",
  ".sqlite3",
  ".tar",
  ".tif",
  ".tiff",
  ".ttf",
  ".wasm",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".xz",
  ".zip",
]);

let mainWindow = null;
let monacoAssetServer = null;
let monacoAssetBaseUrl = "";

function isExistingDirectory(candidatePath) {
  if (!candidatePath) return false;
  try {
    return existsSync(candidatePath) && statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function resolveInitialWorkspaceRoot() {
  if (!app.isPackaged) {
    return __dirname;
  }

  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    path.dirname(process.execPath),
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (isExistingDirectory(candidate)) {
      return candidate;
    }
  }

  return process.cwd();
}

let workspaceRoot = resolveInitialWorkspaceRoot();

function getWorkspaceBootstrapInfo() {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const nodeModulesPath = path.join(workspaceRoot, "node_modules");

  let entries = [];
  try {
    entries = readdirSync(workspaceRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const meaningfulEntries = entries.filter(entry => {
    if (!entry || typeof entry.name !== "string") return false;
    if (entry.name === "." || entry.name === "..") return false;
    return true;
  });

  return {
    rootPath: workspaceRoot,
    rootName: path.basename(workspaceRoot),
    isEmptyFolder: meaningfulEntries.length === 0,
    hasPackageJson: existsSync(packageJsonPath),
    hasNodeModules: existsSync(nodeModulesPath),
  };
}

async function isNpmAvailable() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return await new Promise(resolve => {
    const proc = spawn(npmCmd, ["--version"], {
      cwd: workspaceRoot,
      stdio: "ignore",
      windowsHide: true,
    });
    proc.once("error", () => resolve(false));
    proc.once("close", code => resolve(code === 0));
  });
}

async function installWorkspaceDependencies() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise((resolve, reject) => {
    const proc = spawn(npmCmd, ["install"], {
      cwd: workspaceRoot,
      stdio: "ignore",
      windowsHide: true,
    });
    proc.once("error", reject);
    proc.once("close", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm install exited with code ${String(code)}`));
    });
  });
}

async function ensurePortableWorkspaceReady() {
  const info = getWorkspaceBootstrapInfo();

  if (info.isEmptyFolder) {
    updateSplash("Launching ChaosEdit...", "Empty folder detected. Ready to edit.", 62);
    return {
      ...info,
      bootstrapStatus: "empty-folder",
      bootstrapDetail: "No workspace files found. No dependencies required.",
    };
  }

  if (!info.hasPackageJson) {
    updateSplash("Launching ChaosEdit...", "Workspace has no package.json. Editor mode.", 62);
    return {
      ...info,
      bootstrapStatus: "no-package-json",
      bootstrapDetail: "No Node dependencies required for plain editing.",
    };
  }

  if (info.hasNodeModules) {
    updateSplash("Launching ChaosEdit...", "Workspace dependencies already installed.", 62);
    return {
      ...info,
      bootstrapStatus: "ready",
      bootstrapDetail: "Dependencies already present.",
    };
  }

  const npmReady = await isNpmAvailable();
  if (!npmReady) {
    updateSplash("Launching ChaosEdit...", "npm not found. Skipping dependency install.", 62);
    return {
      ...info,
      bootstrapStatus: "npm-missing",
      bootstrapDetail: "npm was not found; dependencies were not installed.",
    };
  }

  updateSplash("Launching ChaosEdit...", "Installing workspace dependencies...", 56);
  await installWorkspaceDependencies();
  updateSplash("Launching ChaosEdit...", "Workspace dependencies installed.", 66);
  return {
    ...info,
    bootstrapStatus: "installed",
    bootstrapDetail: "Dependencies installed with npm install.",
  };
}

function toPosixPath(value) {
  return value.replaceAll("\\", "/");
}

function isPathInsideRoot(rootPath, targetPath) {
  const normalizeForCompare = value =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const root = normalizeForCompare(path.resolve(rootPath));
  const resolved = normalizeForCompare(path.resolve(targetPath));
  if (resolved === root) return true;
  return resolved.startsWith(`${root}${path.sep}`);
}

function isPathInsideWorkspace(targetPath) {
  return isPathInsideRoot(workspaceRoot, targetPath);
}

function resolveWorkspacePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error("Expected a non-empty workspace path.");
  }

  const normalizedInput = relativePath.replaceAll("/", path.sep).replaceAll("\\", path.sep);
  const resolved = path.resolve(workspaceRoot, normalizedInput);
  if (!isPathInsideWorkspace(resolved)) {
    throw new Error(`Workspace path is outside the root folder: ${relativePath}`);
  }

  return resolved;
}

async function writeWorkspaceFileAtomically(absolutePath, contents) {
  const parentDir = path.dirname(absolutePath);
  await mkdirAsync(parentDir, { recursive: true });

  const tempSuffix = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  const tempPath = path.join(parentDir, `.${path.basename(absolutePath)}.tmp-${process.pid}-${tempSuffix}`);

  try {
    // Write into the destination directory first so rename is atomic on the same volume.
    await writeFileAsync(tempPath, contents, { encoding: "utf8", flag: "wx" });
    await renameAsync(tempPath, absolutePath);
  } catch (error) {
    try {
      await unlinkAsync(tempPath);
    } catch {
      // Ignore temp cleanup errors.
    }
    throw error;
  }
}

function getWorkspaceFileExtension(fileName) {
  return path.extname(fileName.toLowerCase());
}

function isBlockedWorkspaceBinaryFile(fileName) {
  const base = fileName.toLowerCase();
  const extension = getWorkspaceFileExtension(base);
  return Boolean(extension && WORKSPACE_BLOCKED_BINARY_EXTENSIONS.has(extension));
}

function isWorkspaceEditorFile(fileName) {
  const base = fileName.toLowerCase();
  if (WORKSPACE_IGNORED_FILES.has(base)) return false;
  return !isBlockedWorkspaceBinaryFile(base);
}

function isKnownTextWorkspaceFile(fileName) {
  const base = fileName.toLowerCase();
  const extension = getWorkspaceFileExtension(base);
  if (!extension) return true;
  return WORKSPACE_KNOWN_TEXT_EXTENSIONS.has(extension);
}

async function listWorkspaceFiles() {
  const files = [];

  const walk = async relativeDir => {
    if (files.length >= MAX_WORKSPACE_FILES) return;

    const absoluteDir = relativeDir
      ? path.join(workspaceRoot, relativeDir)
      : workspaceRoot;

    let entries = [];
    try {
      entries = await readdirAsync(absoluteDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "EACCES" || error?.code === "EPERM") {
        return;
      }
      throw error;
    }

    entries = entries
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const relativePath = relativeDir
        ? path.join(relativeDir, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        if (WORKSPACE_IGNORED_DIRS.has(entry.name)) continue;
        await walk(relativePath);
        if (files.length >= MAX_WORKSPACE_FILES) return;
        continue;
      }

      if (!entry.isFile()) continue;
      if (!isWorkspaceEditorFile(entry.name)) continue;

      files.push(toPosixPath(relativePath));
      if (files.length >= MAX_WORKSPACE_FILES) return;
    }
  };

  await walk("");
  return files;
}

function isValidMonacoPackageDir(monacoPackageDir) {
  if (!monacoPackageDir) return false;
  const amdLoaderPath = path.join(monacoPackageDir, "min", "vs", "loader.js");
  return existsSync(amdLoaderPath);
}

function getMonacoPackageSourceDir() {
  const candidates = [
    path.join(workspaceRoot, "node_modules", "monaco-editor"),
    path.join(bundledProjectRoot, "node_modules", "monaco-editor"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "node_modules", "monaco-editor"),
    path.join(process.resourcesPath || "", "app.asar", "node_modules", "monaco-editor"),
    path.join(process.resourcesPath || "", "node_modules", "monaco-editor"),
  ];

  for (const candidate of candidates) {
    if (isValidMonacoPackageDir(candidate)) {
      return candidate;
    }
  }
  return "";
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
}

async function findOpenPort(start, end) {
  for (let port = start; port <= end; port += 1) {
    const isOpen = await new Promise(resolve => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, MONACO_ASSET_HOST);
    });
    if (isOpen) return port;
  }
  throw new Error(`No open port found in range ${String(start)}-${String(end)}`);
}

async function startMonacoAssetServer() {
  if (monacoAssetServer && monacoAssetBaseUrl) return monacoAssetBaseUrl;

  const port = await findOpenPort(MONACO_ASSET_PORT_START, MONACO_ASSET_PORT_END);
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${MONACO_ASSET_HOST}`);
      const pathname = decodeURIComponent(requestUrl.pathname || "/");

      if (!pathname.startsWith("/monaco/min/vs/")) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }

      const relativePath = pathname.replace("/monaco/min/vs/", "");
      if (!relativePath || relativePath.includes("\0")) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Bad Request");
        return;
      }

      const sourceDir = getMonacoPackageSourceDir();
      if (!sourceDir) {
        response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Monaco editor assets not found.");
        return;
      }

      const monacoVsRoot = path.join(sourceDir, "min", "vs");
      const absolutePath = path.resolve(monacoVsRoot, relativePath);
      if (!isPathInsideRoot(monacoVsRoot, absolutePath)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
      }

      let fileStat = null;
      try {
        fileStat = await statAsync(absolutePath);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not Found");
          return;
        }
        throw error;
      }
      if (!fileStat.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }

      const body = await readFileAsync(absolutePath);
      response.writeHead(200, {
        "Content-Type": getContentType(absolutePath),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, MONACO_ASSET_HOST, resolve);
  });

  monacoAssetServer = server;
  monacoAssetBaseUrl = `http://${MONACO_ASSET_HOST}:${String(port)}/monaco/min/vs`;
  return monacoAssetBaseUrl;
}

function closeMonacoAssetServer() {
  if (!monacoAssetServer) return;
  try {
    monacoAssetServer.close();
  } catch {
    // Ignore close errors.
  }
  monacoAssetServer = null;
  monacoAssetBaseUrl = "";
}

function updateSplash() {}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#12141a",
    title: "ChaosEdit",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "app.html"));
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
}

ipcMain.handle("minimize-window", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle("maximize-window", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle("close-window", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle("show-context-menu", () => {
  const template = [
    {
      label: "Toggle DevTools",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.toggleDevTools();
        }
      },
    },
    {
      label: "Open Workspace Folder",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("request-open-workspace-folder");
      },
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow || undefined });
});

ipcMain.handle("workspace-info", () => ({
  rootName: path.basename(workspaceRoot),
  rootPath: workspaceRoot,
  ...getWorkspaceBootstrapInfo(),
}));

ipcMain.handle("workspace-select-folder", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { cancelled: true };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    defaultPath: workspaceRoot,
  });
  if (result.canceled || !result.filePaths?.length) {
    return { cancelled: true };
  }

  workspaceRoot = result.filePaths[0];
  return {
    cancelled: false,
    rootName: path.basename(workspaceRoot),
    rootPath: workspaceRoot,
  };
});

ipcMain.handle("workspace-set-root", async (_event, rootPathInput) => {
  if (typeof rootPathInput !== "string" || !rootPathInput.trim()) {
    throw new Error("Expected a folder path.");
  }

  const normalizedInput = rootPathInput
    .trim()
    .replaceAll("/", path.sep)
    .replaceAll("\\", path.sep);

  const absolutePath = path.isAbsolute(normalizedInput)
    ? path.resolve(normalizedInput)
    : path.resolve(workspaceRoot, normalizedInput);

  if (!isExistingDirectory(absolutePath)) {
    throw new Error(`Folder does not exist: ${rootPathInput}`);
  }

  workspaceRoot = absolutePath;
  let bootstrap = null;
  if (app.isPackaged) {
    bootstrap = await ensurePortableWorkspaceReady();
  }

  return {
    cancelled: false,
    rootName: path.basename(workspaceRoot),
    rootPath: workspaceRoot,
    ...(bootstrap || getWorkspaceBootstrapInfo()),
  };
});

ipcMain.handle("workspace-list-files", async () => {
  const files = await listWorkspaceFiles();
  return {
    files,
    truncated: files.length >= MAX_WORKSPACE_FILES,
  };
});

ipcMain.handle("workspace-read-file", async (_event, relativePath) => {
  const absolutePath = resolveWorkspacePath(relativePath);
  let fileStat = null;
  try {
    fileStat = await statAsync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return {
        path: toPosixPath(relativePath),
        missing: true,
      };
    }
    throw error;
  }

  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }

  return {
    path: toPosixPath(relativePath),
    contents: await readFileAsync(absolutePath, "utf8"),
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    missing: false,
  };
});

ipcMain.handle("workspace-write-file", async (_event, relativePath, contents) => {
  if (typeof contents !== "string") {
    throw new Error("Expected file contents as a string.");
  }

  const absolutePath = resolveWorkspacePath(relativePath);
  const baseName = path.basename(absolutePath);
  if (isBlockedWorkspaceBinaryFile(baseName)) {
    throw new Error(
      `Blocked potentially binary file type in the in-app editor: ${relativePath}`
    );
  }

  await writeWorkspaceFileAtomically(absolutePath, contents);
  const updatedStat = await statAsync(absolutePath);
  return {
    path: toPosixPath(relativePath),
    size: updatedStat.size,
    mtimeMs: updatedStat.mtimeMs,
    knownTextType: isKnownTextWorkspaceFile(baseName),
  };
});

ipcMain.handle("workspace-delete-file", async (_event, relativePath) => {
  const absolutePath = resolveWorkspacePath(relativePath);
  let fileStat = null;
  try {
    fileStat = await statAsync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return {
        path: toPosixPath(relativePath),
        missing: true,
      };
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }

  await unlinkAsync(absolutePath);
  return {
    path: toPosixPath(relativePath),
    missing: false,
  };
});

ipcMain.handle("workspace-monaco-base-url", () => ({
  baseUrl: monacoAssetBaseUrl || MONACO_CDN_AMD_BASE_URL,
  baseUrls: [monacoAssetBaseUrl, MONACO_CDN_AMD_BASE_URL].filter(Boolean),
}));

ipcMain.handle("open-external", async (_event, url) => {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Expected a non-empty URL.");
  }

  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Blocked external URL protocol: ${parsed.protocol}`);
  }

  await shell.openExternal(parsed.toString());
});

app.whenReady().then(async () => {
  try {
    updateSplash("Launching ChaosEdit...", "Starting Monaco asset server", 42);
    await startMonacoAssetServer();
    if (app.isPackaged) {
      await ensurePortableWorkspaceReady();
    } else {
      updateSplash("Launching ChaosEdit...", "Development mode: skipping dependency bootstrap", 62);
    }
    updateSplash("Launching ChaosEdit...", "Opening workspace window", 78);
    createWindow();
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "ChaosEdit Startup Failed",
      message: "ChaosEdit could not start.",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeMonacoAssetServer();
});
