(() => {
  const api = window.electronAPI;

  const els = {
    workspaceStatus: document.getElementById("workspace-status"),
    editorStatus: document.getElementById("editor-status"),
    statusIndicator: document.getElementById("status-indicator"),
    currentFileLabel: document.getElementById("current-file-label"),
    consoleBody: document.getElementById("console-body"),
    consoleEl: document.getElementById("console"),
    toggleConsoleBtn: document.getElementById("toggle-console-btn"),
    themeBtn: document.getElementById("theme-btn"),
    openFolderBtn: document.getElementById("open-folder-btn"),
    reloadWorkspaceBtn: document.getElementById("reload-workspace-btn"),
    aboutBtn: document.getElementById("about-btn"),
    clearConsoleBtn: document.getElementById("clear-console-btn"),
    refreshFilesBtn: document.getElementById("refresh-files-btn"),
    fileFilterInput: document.getElementById("file-filter-input"),
    fileList: document.getElementById("file-list"),
    monacoHost: document.getElementById("monaco-host"),
    editorEmpty: document.getElementById("editor-empty"),
    codePaneBody: document.getElementById("code-pane-body"),
    paneResizer: document.getElementById("pane-resizer"),
    saveFileBtn: document.getElementById("save-file-btn"),
    saveAsFileBtn: document.getElementById("save-as-file-btn"),
    newFileBtn: document.getElementById("new-file-btn"),
    deleteFileBtn: document.getElementById("delete-file-btn"),
    undoFileBtn: document.getElementById("undo-file-btn"),
    redoFileBtn: document.getElementById("redo-file-btn"),
    confirmOverlay: document.getElementById("confirm-overlay"),
    confirmTitle: document.getElementById("confirm-title"),
    confirmBody: document.getElementById("confirm-body"),
    confirmOkBtn: document.getElementById("confirm-ok-btn"),
    confirmCancelBtn: document.getElementById("confirm-cancel-btn"),
    pathModalOverlay: document.getElementById("path-modal-overlay"),
    pathModalTitle: document.getElementById("path-modal-title"),
    pathModalBody: document.getElementById("path-modal-body"),
    pathModalInput: document.getElementById("path-modal-input"),
    pathModalBrowseBtn: document.getElementById("path-modal-browse-btn"),
    pathModalOkBtn: document.getElementById("path-modal-ok-btn"),
    pathModalCancelBtn: document.getElementById("path-modal-cancel-btn"),
    aboutOverlay: document.getElementById("about-overlay"),
    aboutModalPanel: document.getElementById("about-modal-panel"),
    aboutHero: document.getElementById("about-hero"),
    aboutCloseBtn: document.getElementById("about-close-btn"),
    aboutGithubBtn: document.getElementById("about-github-btn"),
    aboutMetaWorkspace: document.getElementById("about-meta-workspace"),
    aboutMetaTheme: document.getElementById("about-meta-theme"),
    aboutMetaMonaco: document.getElementById("about-meta-monaco"),
  };

  const KEY_FILE_WIDTH = "dcx-standalone-file-pane-width";
  const KEY_LAST_FILE = "dcx-standalone-last-open-file";
  const KEY_THEME = "dcx-standalone-theme";
  const KEY_CONSOLE = "dcx-standalone-console";

  let workspaceFiles = [];
  let expandedDirs = new Set([""]);
  let activeFilePath = "";
  let lastSavedContents = "";
  let isDirty = false;
  let saveBusy = false;
  let monaco = null;
  let editor = null;
  let monacoReady = null;
  let editorInitPromise = null;
  let openFileRequestId = 0;
  let consoleVisible = true;
  let currentTheme = "dark";
  let currentWorkspaceRoot = "";
  let monacoConnected = false;
  let aboutCloseTimer = null;
  let setValueGuard = false;
  let pendingConfirmResolve = null;
  let pendingPathModalResolve = null;
  let pendingPathModalOptions = null;

  const BLOCKED_EXT = new Set([
    ".exe", ".dll", ".bin", ".db", ".sqlite", ".sqlite3", ".zip", ".rar", ".7z", ".tar",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".mp3", ".mp4", ".wav", ".woff", ".woff2",
  ]);
  const MAX_CONSOLE_LINES = 1200;
  const consoleLines = [];

  const log = msg => {
    const ts = new Date().toLocaleTimeString();
    consoleLines.push(`[${ts}] ${String(msg)}`);
    if (consoleLines.length > MAX_CONSOLE_LINES) {
      consoleLines.splice(0, consoleLines.length - MAX_CONSOLE_LINES);
    }
    els.consoleBody.textContent = `${consoleLines.join("\n")}\n`;
    els.consoleBody.scrollTop = els.consoleBody.scrollHeight;
  };

  const setWorkspaceStatus = msg => {
    if (!els.workspaceStatus) return;
    const normalized = String(msg ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    els.workspaceStatus.textContent = normalized.slice(0, 180);
  };

  const setEditorStatus = msg => {
    if (!els.editorStatus) return;
    const normalized = String(msg ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    els.editorStatus.textContent = normalized.slice(0, 220);
  };

  const setMonacoLinkState = (connected, detail = "") => {
    monacoConnected = Boolean(connected);
    if (!els.statusIndicator) return;
    els.statusIndicator.classList.toggle("connected", Boolean(connected));
    els.statusIndicator.classList.toggle("disconnected", !connected);
    els.statusIndicator.title = connected
      ? "Monaco connected"
      : detail
        ? `Monaco disconnected: ${detail}`
        : "Monaco disconnected";
    updateAboutMeta();
  };

  const setTheme = theme => {
    currentTheme = theme === "light" ? "light" : "dark";
    document.body.setAttribute("data-theme", currentTheme);
    window.localStorage.setItem(KEY_THEME, currentTheme);
    updateAboutMeta();
    if (monaco?.editor) {
      monaco.editor.setTheme(currentTheme === "light" ? "vs" : "vs-dark");
    }
  };

  const setConsoleVisible = visible => {
    consoleVisible = Boolean(visible);
    els.consoleEl?.classList.toggle("minimized", !consoleVisible);
    els.toggleConsoleBtn?.classList.toggle("active", consoleVisible);
    window.localStorage.setItem(KEY_CONSOLE, consoleVisible ? "1" : "0");
  };

  const updateFileLabel = () => {
    if (!els.currentFileLabel) return;
    if (!activeFilePath) {
      els.currentFileLabel.textContent = "No file selected";
      return;
    }
    els.currentFileLabel.textContent = isDirty ? `${activeFilePath} *` : activeFilePath;
  };

  const shortName = filePath => {
    if (typeof filePath !== "string" || !filePath) return "";
    const normalized = filePath.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || normalized;
  };

  const workspaceName = () => {
    if (!currentWorkspaceRoot) return "Unknown";
    return shortName(currentWorkspaceRoot) || currentWorkspaceRoot;
  };

  const updateAboutMeta = () => {
    if (els.aboutMetaWorkspace) {
      els.aboutMetaWorkspace.textContent = workspaceName();
      els.aboutMetaWorkspace.title = currentWorkspaceRoot || workspaceName();
    }
    if (els.aboutMetaTheme) {
      els.aboutMetaTheme.textContent = currentTheme === "light" ? "Light" : "Dark";
    }
    if (els.aboutMetaMonaco) {
      els.aboutMetaMonaco.textContent = monacoConnected ? "Connected" : "Disconnected";
    }
  };

  const runAboutGlitch = phase => {
    const target = els.aboutHero || els.aboutModalPanel;
    const glitchApi = window.PowerGlitch;
    if (!target || !glitchApi?.glitch) return;
    const isClose = phase === "close";
    const duration = isClose ? 220 : 360;
    try {
      const instance = glitchApi.glitch(target, {
        playMode: "always",
        createContainers: true,
        hideOverflow: false,
        timing: { duration, iterations: 1 },
        glitchTimeSpan: { start: 0, end: 1 },
        shake: {
          velocity: isClose ? 11 : 14,
          amplitudeX: isClose ? 0.045 : 0.065,
          amplitudeY: isClose ? 0.04 : 0.06,
        },
        slice: {
          count: isClose ? 5 : 7,
          velocity: isClose ? 10 : 14,
          minHeight: 0.02,
          maxHeight: isClose ? 0.1 : 0.14,
          hueRotate: !isClose,
          cssFilters: "",
        },
        pulse: false,
      });
      window.setTimeout(() => {
        try {
          instance?.stopGlitch?.();
        } catch {
          // Ignore cleanup issues from animation teardown.
        }
      }, duration + 50);
    } catch {
      // Graceful fallback to CSS-only animation.
    }
  };

  const openAboutModal = () => {
    if (!els.aboutOverlay || !els.aboutModalPanel) return;
    if (aboutCloseTimer) {
      window.clearTimeout(aboutCloseTimer);
      aboutCloseTimer = null;
    }
    updateAboutMeta();
    els.aboutOverlay.classList.remove("hidden");
    const modal = els.aboutModalPanel;
    modal.classList.remove("about-closing");
    modal.classList.add("about-opening");
    window.setTimeout(() => {
      modal.classList.remove("about-opening");
    }, 420);
    runAboutGlitch("open");
  };

  const closeAboutModal = () => {
    if (!els.aboutOverlay || !els.aboutModalPanel) return;
    if (els.aboutOverlay.classList.contains("hidden")) return;
    const modal = els.aboutModalPanel;
    modal.classList.remove("about-opening");
    modal.classList.add("about-closing");
    runAboutGlitch("close");
    if (aboutCloseTimer) window.clearTimeout(aboutCloseTimer);
    aboutCloseTimer = window.setTimeout(() => {
      els.aboutOverlay.classList.add("hidden");
      modal.classList.remove("about-closing");
      aboutCloseTimer = null;
    }, 220);
  };

  const updateButtonState = () => {
    const canEdit = Boolean(activeFilePath && editor);
    const disabled = saveBusy || !canEdit;
    for (const btn of [els.saveFileBtn, els.deleteFileBtn, els.undoFileBtn, els.redoFileBtn]) {
      if (!btn) continue;
      btn.disabled = disabled;
      btn.style.opacity = disabled ? "0.5" : "1";
    }
    if (els.saveAsFileBtn) {
      els.saveAsFileBtn.disabled = saveBusy || !editor;
      els.saveAsFileBtn.style.opacity = els.saveAsFileBtn.disabled ? "0.5" : "1";
    }
    if (els.newFileBtn) {
      els.newFileBtn.disabled = saveBusy;
      els.newFileBtn.style.opacity = saveBusy ? "0.5" : "1";
    }
  };

  const showConfirmModal = ({
    title,
    body,
    okLabel = "Confirm",
    danger = false,
  }) => {
    if (
      !els.confirmOverlay ||
      !els.confirmTitle ||
      !els.confirmBody ||
      !els.confirmOkBtn ||
      !els.confirmCancelBtn
    ) {
      return Promise.resolve(window.confirm(body || "Are you sure?"));
    }

    if (pendingConfirmResolve) {
      pendingConfirmResolve(false);
      pendingConfirmResolve = null;
    }

    els.confirmTitle.textContent = title || "Confirm";
    els.confirmBody.textContent = body || "";
    els.confirmOkBtn.textContent = okLabel;
    els.confirmOkBtn.classList.toggle("danger", Boolean(danger));
    els.confirmOverlay.classList.remove("hidden");
    els.confirmOkBtn.focus();

    return new Promise(resolve => {
      pendingConfirmResolve = resolve;
    });
  };

  const resolveConfirmModal = accepted => {
    if (els.confirmOverlay) {
      els.confirmOverlay.classList.add("hidden");
    }
    const resolver = pendingConfirmResolve;
    pendingConfirmResolve = null;
    if (resolver) resolver(Boolean(accepted));
  };

  const normalizeRelativePathInput = value => {
    if (typeof value !== "string") return "";
    return value
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
      .replace(/\/{2,}/g, "/");
  };

  const normalizeFolderPathInput = value => {
    if (typeof value !== "string") return "";
    return value.trim().replaceAll("\\", "/");
  };

  const normalizeEditorText = value => {
    if (typeof value !== "string") return "";
    return value.replace(/\r\n/g, "\n");
  };

  const isUnsafeRelativePath = relativePath =>
    !relativePath ||
    relativePath.startsWith("..") ||
    relativePath.includes("/../") ||
    relativePath.endsWith("/..");

  const showPathModal = ({
    title,
    body,
    okLabel = "OK",
    suggestedPath = "",
    mode = "relative-file",
  }) => {
    if (
      !els.pathModalOverlay ||
      !els.pathModalTitle ||
      !els.pathModalBody ||
      !els.pathModalInput ||
      !els.pathModalOkBtn ||
      !els.pathModalCancelBtn
    ) {
      const raw = window.prompt(title || "Enter file path", suggestedPath);
      if (raw === null) return Promise.resolve({ accepted: false, value: "" });
    const normalized =
      mode === "folder-path"
        ? normalizeFolderPathInput(raw)
        : normalizeRelativePathInput(raw);
    return Promise.resolve({ accepted: true, value: normalized });
    }

    if (pendingPathModalResolve) {
      pendingPathModalResolve({ accepted: false, value: "" });
      pendingPathModalResolve = null;
    }
    pendingPathModalOptions = { mode };
    const browseAllowed = mode === "folder-path";

    els.pathModalTitle.textContent = title || "Enter File Path";
    els.pathModalBody.textContent = body || "Use a path relative to workspace root.";
    els.pathModalOkBtn.textContent = okLabel;
    if (els.pathModalBrowseBtn) {
      els.pathModalBrowseBtn.classList.toggle("hidden", !browseAllowed);
      els.pathModalBrowseBtn.disabled = !browseAllowed;
    }
    els.pathModalInput.value = suggestedPath || "";
    els.pathModalInput.classList.remove("invalid");
    els.pathModalOverlay.classList.remove("hidden");
    window.setTimeout(() => {
      els.pathModalInput.focus();
      els.pathModalInput.select();
    }, 0);

    return new Promise(resolve => {
      pendingPathModalResolve = resolve;
    });
  };

  const resolvePathModal = accepted => {
    if (!els.pathModalOverlay || !els.pathModalInput) {
      const resolver = pendingPathModalResolve;
      pendingPathModalResolve = null;
      if (resolver) resolver({ accepted: Boolean(accepted), value: "" });
      return;
    }

    if (!accepted) {
      els.pathModalOverlay.classList.add("hidden");
      const resolver = pendingPathModalResolve;
      pendingPathModalResolve = null;
      pendingPathModalOptions = null;
      if (resolver) resolver({ accepted: false, value: "" });
      return;
    }

    const mode = pendingPathModalOptions?.mode || "relative-file";
    const normalized =
      mode === "folder-path"
        ? normalizeFolderPathInput(els.pathModalInput.value)
        : normalizeRelativePathInput(els.pathModalInput.value);

    if (!normalized || (mode === "relative-file" && isUnsafeRelativePath(normalized))) {
      els.pathModalInput.classList.add("invalid");
      setEditorStatus(
        mode === "folder-path"
          ? "Invalid folder path."
          : "Invalid path. Use a workspace-relative file path."
      );
      els.pathModalInput.focus();
      return;
    }

    els.pathModalInput.classList.remove("invalid");
    els.pathModalOverlay.classList.add("hidden");
    const resolver = pendingPathModalResolve;
    pendingPathModalResolve = null;
    pendingPathModalOptions = null;
    if (resolver) resolver({ accepted: true, value: normalized });
  };

  const isDirtyNow = () =>
    Boolean(editor) && normalizeEditorText(editor.getValue()) !== normalizeEditorText(lastSavedContents);

  const getLanguageForPath = filePath => {
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    if (ext === ".md" || ext === ".mdx") return "markdown";
    if (ext === ".ts" || ext === ".tsx") return "typescript";
    if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return "javascript";
    if (ext === ".json" || ext === ".jsonc") return "json";
    if (ext === ".yml" || ext === ".yaml") return "yaml";
    if (ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less") return "css";
    if (ext === ".html" || ext === ".astro") return "html";
    if (ext === ".xml" || ext === ".svg") return "xml";
    return "plaintext";
  };

  const loadScript = (src, { forceReload = false } = {}) => {
    if (forceReload && window.__dcxScripts?.[src]) {
      delete window.__dcxScripts[src];
    }
    const existing = window.__dcxScripts?.[src];
    if (existing) return existing;
    window.__dcxScripts = window.__dcxScripts || {};
    window.__dcxScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const timeout = window.setTimeout(() => reject(new Error(`Timed out loading ${src}`)), 20000);
      const cacheBuster = `dcx=${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
      const scriptSrc = forceReload
        ? `${src}${src.includes("?") ? "&" : "?"}${cacheBuster}`
        : src;
      s.src = scriptSrc;
      s.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      s.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error(`Failed to load ${src}`));
      };
      document.head.appendChild(s);
    }).catch(error => {
      if (window.__dcxScripts?.[src]) {
        delete window.__dcxScripts[src];
      }
      throw error;
    });
    return window.__dcxScripts[src];
  };

  const loadMonacoFromBase = async (baseUrl, { forceLoaderReload = false } = {}) => {
    const base = String(baseUrl).replace(/\/+$/, "");
    const waitForAmdLoader = async () => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (window.require && typeof window.require.config === "function") return;
        await new Promise(resolve => window.setTimeout(resolve, 25));
      }
      throw new Error("Monaco AMD loader did not initialize.");
    };

    if (forceLoaderReload) {
      const loaderSrc = `${base}/loader.js`;
      if (window.__dcxScripts?.[loaderSrc]) {
        delete window.__dcxScripts[loaderSrc];
      }
    }

    if (!window.require || typeof window.require.config !== "function" || forceLoaderReload) {
      await loadScript(`${base}/loader.js`, { forceReload: forceLoaderReload });
      await waitForAmdLoader();
    }

    window.require.config({
      paths: { vs: base },
      waitSeconds: 30,
    });

    try {
      window.require.undef?.("vs/editor/editor.main");
    } catch {
      // Ignore undef support differences.
    }

    await new Promise((resolve, reject) => {
      let settled = false;
      const previousOnError = window.require.onError;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        window.require.onError = previousOnError;
        reject(new Error("Timed out loading Monaco editor modules."));
      }, 40000);

      window.require.onError = error => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.require.onError = previousOnError;
        reject(
          new Error(
            `Monaco AMD error: ${error?.requireType || "unknown"} ${String(
              error?.requireModules || ""
            )}`.trim()
          )
        );
      };

      window.require(
        ["vs/editor/editor.main"],
        () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          window.require.onError = previousOnError;
          resolve();
        },
        error => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          window.require.onError = previousOnError;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });

    if (!window.monaco?.editor) throw new Error("Monaco not available");
    return window.monaco;
  };

  const ensureEditor = async () => {
    if (editor && !editor.isDisposed?.()) {
      setMonacoLinkState(true);
      return editor;
    }
    if (editorInitPromise) return editorInitPromise;

    editorInitPromise = (async () => {
      if (!monacoReady) {
        monacoReady = (async () => {
          const response = await api.getWorkspaceMonacoBaseUrl();
          const bases = Array.isArray(response?.baseUrls) ? response.baseUrls : [];
          let lastErr = null;
          for (const base of bases) {
            for (let attempt = 1; attempt <= 2; attempt += 1) {
              try {
                monaco = await loadMonacoFromBase(base, { forceLoaderReload: attempt > 1 });
                log(`Monaco loaded from ${base}`);
                break;
              } catch (error) {
                lastErr = error;
                const suffix = attempt > 1 ? ` [attempt ${attempt}/2]` : "";
                log(`Monaco source failed (${base})${suffix}: ${error.message}`);
              }
            }
            if (monaco?.editor) break;
          }
          if (!monaco?.editor) {
            const errorToThrow = lastErr || new Error("Unable to load Monaco.");
            setMonacoLinkState(false, errorToThrow.message);
            throw errorToThrow;
          }
        })();
      }

      await monacoReady;
      if (editor && !editor.isDisposed?.()) return editor;

      editor = monaco.editor.create(els.monacoHost, {
        value: "",
        language: "plaintext",
        automaticLayout: true,
        minimap: { enabled: false },
        smoothScrolling: true,
        scrollBeyondLastLine: false,
        fontSize: 13,
      });
      setTheme(currentTheme);
      editor.onDidChangeModelContent(() => {
        if (setValueGuard || !activeFilePath) return;
        const next = isDirtyNow();
        if (next === isDirty) return;
        isDirty = next;
        updateFileLabel();
        renderFiles();
      });
      updateButtonState();
      setMonacoLinkState(true);
      return editor;
    })();

    try {
      return await editorInitPromise;
    } finally {
      editorInitPromise = null;
    }
  };

  const buildTree = files => {
    const root = { dirs: new Map(), files: [] };
    for (const file of files) {
      const parts = file.split("/");
      let node = root;
      let current = "";
      for (let i = 0; i < parts.length; i += 1) {
        const segment = parts[i];
        current = current ? `${current}/${segment}` : segment;
        if (i === parts.length - 1) {
          node.files.push({ name: segment, path: current });
        } else {
          if (!node.dirs.has(segment)) node.dirs.set(segment, { dirs: new Map(), files: [], path: current, name: segment });
          node = node.dirs.get(segment);
        }
      }
    }
    return root;
  };

  const renderFiles = () => {
    const filter = (els.fileFilterInput?.value || "").trim().toLowerCase();
    const source = filter ? workspaceFiles.filter(f => f.toLowerCase().includes(filter)) : workspaceFiles;
    els.fileList.textContent = "";
    if (!source.length) {
      const empty = document.createElement("div");
      empty.className = "file-empty";
      empty.textContent = filter ? "No files match this filter." : "No editable files found.";
      els.fileList.appendChild(empty);
      return;
    }
    const tree = buildTree(source.slice(0, 2000));
    const forceOpen = Boolean(filter);
    const renderNode = (node, depth) => {
      const dirs = Array.from(node.dirs.values()).sort((a, b) => a.name.localeCompare(b.name));
      const files = node.files.slice().sort((a, b) => a.name.localeCompare(b.name));
      for (const dir of dirs) {
        const expanded = forceOpen || expandedDirs.has(dir.path);
        const btn = document.createElement("button");
        btn.className = "file-item dir";
        btn.type = "button";
        btn.style.paddingLeft = `${8 + depth * 14}px`;
        const toggle = document.createElement("span");
        toggle.className = "file-tree-toggle";
        toggle.textContent = expanded ? "v" : ">";
        const label = document.createElement("span");
        label.className = "file-tree-label";
        label.textContent = dir.name;
        btn.append(toggle, label);
        btn.title = dir.path;
        btn.addEventListener("click", () => {
          if (expandedDirs.has(dir.path)) expandedDirs.delete(dir.path); else expandedDirs.add(dir.path);
          renderFiles();
        });
        els.fileList.appendChild(btn);
        if (expanded) renderNode(dir, depth + 1);
      }
      for (const file of files) {
        const btn = document.createElement("button");
        btn.className = "file-item";
        btn.type = "button";
        btn.style.paddingLeft = `${24 + depth * 14}px`;
        btn.textContent = file.name;
        btn.title = file.path;
        if (file.path === activeFilePath) btn.classList.add("active");
        if (isDirty && file.path === activeFilePath) btn.classList.add("dirty");
        btn.addEventListener("click", () => openFile(file.path));
        els.fileList.appendChild(btn);
      }
    };
    renderNode(tree, 0);
  };

  const refreshWorkspace = async () => {
    setWorkspaceStatus("Loading files...");
    try {
      const [info, listed] = await Promise.all([api.getWorkspaceInfo(), api.listWorkspaceFiles()]);
      workspaceFiles = Array.isArray(listed?.files) ? listed.files : [];
      const truncated = Boolean(listed?.truncated);
      const rootName = info?.rootName || "Workspace";
      currentWorkspaceRoot = info?.rootPath || currentWorkspaceRoot;
      updateAboutMeta();
      setWorkspaceStatus(
        truncated
          ? `Folder: ${rootName} - ${workspaceFiles.length} files (truncated)`
          : `Folder: ${rootName} - ${workspaceFiles.length} files`
      );
      if (truncated) {
        log("Workspace file list was truncated at the configured limit.");
      }
      if (info?.isEmptyFolder) {
        setEditorStatus("Empty folder detected. Create a file to get started.");
      }
      renderFiles();
      if (!activeFilePath) {
        const last = window.localStorage.getItem(KEY_LAST_FILE) || "";
        if (last && workspaceFiles.includes(last)) openFile(last);
      } else if (!workspaceFiles.includes(activeFilePath)) {
        activeFilePath = "";
        isDirty = false;
        updateFileLabel();
        updateButtonState();
        els.editorEmpty.classList.remove("hidden");
      }
    } catch (error) {
      setWorkspaceStatus("Failed to load files");
      log(`File list error: ${error.message}`);
    }
  };

  const openFile = async relativePath => {
    if (!relativePath) return;
    if (editor && activeFilePath && activeFilePath !== relativePath && isDirtyNow()) {
      const discard = await showConfirmModal({
        title: "Unsaved Changes",
        body: "You have unsaved changes. Discard them and open another file?",
        okLabel: "Discard",
        danger: true,
      });
      if (!discard) return;
    }
    setEditorStatus(`Opening ${relativePath}...`);
    const requestId = ++openFileRequestId;
    try {
      const payload = await api.readWorkspaceFile(relativePath);
      if (requestId !== openFileRequestId) return;
      if (payload?.missing) throw new Error(`File not found: ${relativePath}`);
      const filePath = payload?.path || relativePath;
      const contents = payload?.contents || "";
      const ed = await ensureEditor();
      if (requestId !== openFileRequestId) return;
      setValueGuard = true;
      ed.setValue(contents);
      const model = ed.getModel();
      if (model && monaco?.editor?.setModelLanguage) {
        monaco.editor.setModelLanguage(model, getLanguageForPath(filePath));
      }
      setValueGuard = false;
      els.editorEmpty.classList.add("hidden");
      activeFilePath = filePath;
      lastSavedContents = normalizeEditorText(contents);
      isDirty = false;
      updateFileLabel();
      updateButtonState();
      renderFiles();
      setEditorStatus(`Loaded ${shortName(filePath)}`);
      window.localStorage.setItem(KEY_LAST_FILE, filePath);
      ed.focus();
    } catch (error) {
      if (requestId !== openFileRequestId) return;
      setValueGuard = false;
      setEditorStatus("Failed to open file");
      log(`Open file failed: ${error.message}`);
    }
  };

  const saveFile = async (targetPath = activeFilePath) => {
    if (!editor) {
      setEditorStatus("Open a file before saving.");
      return;
    }
    if (!targetPath) {
      setEditorStatus("No file selected. Use Save As or New File first.");
      return;
    }
    const ext = targetPath.includes(".") ? targetPath.slice(targetPath.lastIndexOf(".")).toLowerCase() : "";
    if (BLOCKED_EXT.has(ext)) {
      setEditorStatus(`Blocked binary type (${ext})`);
      return;
    }
    saveBusy = true;
    updateButtonState();
    try {
      const currentValue = editor.getValue();
      await api.writeWorkspaceFile(targetPath, currentValue);
      lastSavedContents = normalizeEditorText(currentValue);
      isDirty = false;
      activeFilePath = targetPath;
      updateFileLabel();
      renderFiles();
      setEditorStatus(`Saved ${shortName(targetPath)}`);
      log(`Saved ${targetPath}`);
      refreshWorkspace();
    } catch (error) {
      setEditorStatus("Save failed");
      log(`Save failed: ${error.message}`);
    } finally {
      saveBusy = false;
      updateButtonState();
    }
  };

  const saveAs = async () => {
    if (!editor) {
      setEditorStatus("Open a file before using Save As.");
      return;
    }
    const suggested = activeFilePath
      ? activeFilePath.replace(/(\.[^./]+)?$/, "-copy$1")
      : "new-file.md";
    const pathResult = await showPathModal({
      title: "Save File As",
      body: "Enter destination path relative to workspace root.",
      okLabel: "Save As",
      suggestedPath: suggested,
    });
    if (!pathResult?.accepted || !pathResult.value) return;
    let exists = false;
    try {
      const probe = await api.readWorkspaceFile(pathResult.value);
      exists = !probe?.missing;
    } catch {
      exists = false;
    }
    if (exists && pathResult.value !== activeFilePath) {
      const overwrite = await showConfirmModal({
        title: "Overwrite File?",
        body: `"${pathResult.value}" already exists. Overwrite it?`,
        okLabel: "Overwrite",
      });
      if (!overwrite) return;
    }
    await saveFile(pathResult.value);
  };

  const newFile = async () => {
    const pathResult = await showPathModal({
      title: "Create New File",
      body: "Enter a new file path relative to workspace root.",
      okLabel: "Create",
      suggestedPath: "new-file.md",
    });
    if (!pathResult?.accepted || !pathResult.value) return;
    const rel = pathResult.value;
    let exists = false;
    try {
      const probe = await api.readWorkspaceFile(rel);
      exists = !probe?.missing;
    } catch {
      exists = false;
    }
    if (exists) {
      const overwrite = await showConfirmModal({
        title: "Overwrite File?",
        body: `"${rel}" already exists. Overwrite it?`,
        okLabel: "Overwrite",
      });
      if (!overwrite) return;
    }
    try {
      await api.writeWorkspaceFile(rel, "");
      await refreshWorkspace();
      await openFile(rel);
    } catch (error) {
      log(`Create file failed: ${error.message}`);
    }
  };

  const deleteFile = async () => {
    if (!activeFilePath) return;
    const accepted = await showConfirmModal({
      title: "Delete File",
      body: `Delete "${activeFilePath}"? This cannot be undone.`,
      okLabel: "Delete",
      danger: true,
    });
    if (!accepted) return;
    try {
      await api.deleteWorkspaceFile(activeFilePath);
      log(`Deleted ${activeFilePath}`);
      activeFilePath = "";
      lastSavedContents = "";
      isDirty = false;
      updateFileLabel();
      updateButtonState();
      await refreshWorkspace();
    } catch (error) {
      log(`Delete failed: ${error.message}`);
    }
  };

  const switchWorkspaceRoot = async rootPath => {
    if (!api?.setWorkspaceRoot) {
      throw new Error("Set workspace root API is unavailable.");
    }

    const result = await api.setWorkspaceRoot(rootPath);
    if (result?.cancelled) return;

    activeFilePath = "";
    lastSavedContents = "";
    isDirty = false;
    updateFileLabel();
    updateButtonState();
    currentWorkspaceRoot = result?.rootPath || currentWorkspaceRoot;
    setWorkspaceStatus(`Workspace: ${result?.rootName || "Updated"}`);
    log(`Workspace switched to ${result?.rootPath || "selected folder"}`);
    await refreshWorkspace();
  };

  const bindWindowControl = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", evt => {
      evt.preventDefault();
      evt.stopPropagation();
      fn().catch?.(() => {});
    });
  };

  const initSplitter = () => {
    const saved = Number.parseInt(window.localStorage.getItem(KEY_FILE_WIDTH) || "", 10);
    const apply = width => {
      const total = els.codePaneBody.clientWidth || 1100;
      const clamped = Math.max(180, Math.min(total - 360, Math.round(width)));
      els.codePaneBody.style.setProperty("--file-pane-width", `${clamped}px`);
      window.localStorage.setItem(KEY_FILE_WIDTH, String(clamped));
      editor?.layout();
    };
    apply(Number.isFinite(saved) ? saved : 250);
    let dragging = false;
    let startX = 0;
    let startWidth = 250;
    const onMove = e => {
      if (!dragging) return;
      apply(startWidth + (e.clientX - startX));
    };
    const onUp = () => {
      dragging = false;
      els.paneResizer.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    els.paneResizer?.addEventListener("pointerdown", e => {
      dragging = true;
      startX = e.clientX;
      startWidth = Number.parseInt(getComputedStyle(els.codePaneBody).getPropertyValue("--file-pane-width"), 10) || 250;
      els.paneResizer.classList.add("dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  };

  bindWindowControl("min-btn", () => api.minimizeWindow());
  bindWindowControl("max-btn", () => api.maximizeWindow());
  bindWindowControl("close-btn", () => api.closeWindow());

  els.toggleConsoleBtn?.addEventListener("click", () => setConsoleVisible(!consoleVisible));
  els.themeBtn?.addEventListener("click", () => setTheme(currentTheme === "light" ? "dark" : "light"));
  els.aboutBtn?.addEventListener("click", () => {
    openAboutModal();
  });
  els.openFolderBtn?.addEventListener("click", async () => {
    if (editor && activeFilePath && isDirtyNow()) {
      const discard = await showConfirmModal({
        title: "Unsaved Changes",
        body: "You have unsaved changes. Discard them and switch folder?",
        okLabel: "Discard",
        danger: true,
      });
      if (!discard) return;
    }

    const pathResult = await showPathModal({
      title: "Open Folder",
      body: "Enter a folder path to use as workspace. Absolute or relative paths are allowed.",
      okLabel: "Open",
      suggestedPath: currentWorkspaceRoot || "",
      mode: "folder-path",
    });
    if (!pathResult?.accepted || !pathResult.value) return;

    try {
      await switchWorkspaceRoot(pathResult.value);
    } catch (error) {
      setEditorStatus("Open folder failed");
      log(`Open folder failed: ${error.message}`);
    }
  });
  api.onRequestOpenWorkspaceFolder?.(() => {
    els.openFolderBtn?.click();
  });
  els.reloadWorkspaceBtn?.addEventListener("click", () => {
    log("Reloading ChaosEdit...");
    window.location.reload();
  });
  els.clearConsoleBtn?.addEventListener("click", () => {
    consoleLines.length = 0;
    els.consoleBody.textContent = "";
  });
  els.refreshFilesBtn?.addEventListener("click", () => refreshWorkspace());
  els.fileFilterInput?.addEventListener("input", () => renderFiles());

  els.confirmOkBtn?.addEventListener("click", () => resolveConfirmModal(true));
  els.confirmCancelBtn?.addEventListener("click", () => resolveConfirmModal(false));
  els.confirmOverlay?.addEventListener("click", event => {
    if (event.target === els.confirmOverlay) resolveConfirmModal(false);
  });

  els.aboutCloseBtn?.addEventListener("click", () => closeAboutModal());
  els.aboutOverlay?.addEventListener("click", event => {
    if (event.target === els.aboutOverlay) {
      closeAboutModal();
    }
  });
  els.aboutGithubBtn?.addEventListener("click", () => {
    api.openExternal?.("https://github.com/deadcodeXO/ChaosEdit").catch(() => {
      log("Failed to open GitHub link.");
    });
  });

  els.pathModalOkBtn?.addEventListener("click", () => resolvePathModal(true));
  els.pathModalCancelBtn?.addEventListener("click", () => resolvePathModal(false));
  els.pathModalBrowseBtn?.addEventListener("click", async () => {
    if (!pendingPathModalResolve) return;
    const mode = pendingPathModalOptions?.mode || "relative-file";
    if (mode !== "folder-path") return;
    if (!api?.selectWorkspaceFolder) {
      log("Folder browse is unavailable in this build.");
      return;
    }
    try {
      const selected = await api.selectWorkspaceFolder();
      if (selected?.cancelled || !selected?.rootPath) return;
      els.pathModalInput.value = normalizeFolderPathInput(selected.rootPath);
      els.pathModalInput.classList.remove("invalid");
      els.pathModalInput.focus();
      els.pathModalInput.select();
    } catch (error) {
      log(`Folder browse failed: ${error.message}`);
    }
  });
  els.pathModalOverlay?.addEventListener("click", event => {
    if (event.target === els.pathModalOverlay) resolvePathModal(false);
  });
  els.pathModalInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      resolvePathModal(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resolvePathModal(false);
    }
  });

  els.saveFileBtn?.addEventListener("click", () => saveFile());
  els.saveAsFileBtn?.addEventListener("click", () => saveAs());
  els.newFileBtn?.addEventListener("click", () => newFile());
  els.deleteFileBtn?.addEventListener("click", () => deleteFile());
  els.undoFileBtn?.addEventListener("click", () => editor?.trigger("keyboard", "undo", null));
  els.redoFileBtn?.addEventListener("click", () => editor?.trigger("keyboard", "redo", null));

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && els.aboutOverlay && !els.aboutOverlay.classList.contains("hidden")) {
      event.preventDefault();
      closeAboutModal();
      return;
    }
    if (event.key === "Escape" && pendingPathModalResolve) {
      event.preventDefault();
      resolvePathModal(false);
      return;
    }
    if (event.key === "Escape" && pendingConfirmResolve) {
      event.preventDefault();
      resolveConfirmModal(false);
      return;
    }
    if (pendingPathModalResolve || pendingConfirmResolve) return;

    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (event.shiftKey) saveAs(); else saveFile();
    }
    if (key === "f") {
      event.preventDefault();
      els.fileFilterInput?.focus();
      els.fileFilterInput?.select();
    }
    if (key === "o") {
      event.preventDefault();
      els.openFolderBtn?.click();
    }
    if (key === "l" && event.shiftKey) {
      event.preventDefault();
      setConsoleVisible(!consoleVisible);
    }
  });

  document.addEventListener("contextmenu", event => {
    if (els.monacoHost?.contains(event.target)) return;
    event.preventDefault();
    api.showContextMenu?.().catch(() => {});
  });

  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  setMonacoLinkState(false, "Editor not initialized");
  setTheme(window.localStorage.getItem(KEY_THEME) || (prefersLight ? "light" : "dark"));
  setConsoleVisible(window.localStorage.getItem(KEY_CONSOLE) !== "0");
  updateFileLabel();
  updateButtonState();
  initSplitter();
  refreshWorkspace();
  ensureEditor().catch(error => {
    setMonacoLinkState(false, error?.message || String(error));
    log(`Monaco preload failed: ${error.message}`);
  });
  setWorkspaceStatus("Ready");
  setEditorStatus("Editor ready");
  log("ChaosEdit initialized.");
})();


