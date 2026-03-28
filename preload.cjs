const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  maximizeWindow: () => ipcRenderer.invoke("maximize-window"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  showContextMenu: () => ipcRenderer.invoke("show-context-menu"),
  openExternal: url => ipcRenderer.invoke("open-external", url),
  getWorkspaceInfo: () => ipcRenderer.invoke("workspace-info"),
  setWorkspaceRoot: rootPath => ipcRenderer.invoke("workspace-set-root", rootPath),
  selectWorkspaceFolder: () => ipcRenderer.invoke("workspace-select-folder"),
  listWorkspaceFiles: () => ipcRenderer.invoke("workspace-list-files"),
  readWorkspaceFile: relativePath =>
    ipcRenderer.invoke("workspace-read-file", relativePath),
  writeWorkspaceFile: (relativePath, contents) =>
    ipcRenderer.invoke("workspace-write-file", relativePath, contents),
  deleteWorkspaceFile: relativePath =>
    ipcRenderer.invoke("workspace-delete-file", relativePath),
  getWorkspaceMonacoBaseUrl: () =>
    ipcRenderer.invoke("workspace-monaco-base-url"),
  onRequestOpenWorkspaceFolder: callback => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("request-open-workspace-folder", () => {
      callback();
    });
  },
});
