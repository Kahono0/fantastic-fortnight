// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// Electron preload script: exposes a small IPC-backed API to the renderer
// This file should be used as the preload script when creating the BrowserWindow
// e.g. new BrowserWindow({ webPreferences: { preload: path.join(__dirname, 'preload.js') } })

const { contextBridge, ipcRenderer } = require("electron");

const myappAPI = {
  // Fields
  getAllFields: () => ipcRenderer.invoke("getAllFields"),
  getStaticFields: () => ipcRenderer.invoke("getStaticFields"),
  getCustomFields: () => ipcRenderer.invoke("getCustomFields"),
  addCustomField: (field) => ipcRenderer.invoke("addCustomField", field),
  uploadStaticFieldsToSupabase: (fieldsData) =>
    ipcRenderer.invoke("uploadStaticFieldsToSupabase", fieldsData),

  // Issues
  getAllIssues: () => ipcRenderer.invoke("getAllIssues"),
  createIssue: (issueData) => ipcRenderer.invoke("createIssue", issueData),
  getIssueById: (id) => ipcRenderer.invoke("getIssueById", id),
  queryIssues: (filters) => ipcRenderer.invoke("queryIssues", filters),
  selectFolder: () => ipcRenderer.invoke("selectFolder"),
  selectExcelFile: () => ipcRenderer.invoke("selectExcelFile"),
  previewExcel: (filePath) => ipcRenderer.invoke("previewExcel", filePath),
  // Import and process an Excel file on the main process (returns summary)
  importExcel: (filePath, mapping) =>
    ipcRenderer.invoke("importExcel", filePath, mapping),
};

contextBridge.exposeInMainWorld("myappAPI", myappAPI);

// Optionally export for require() callers in tests or debug contexts
module.exports = myappAPI;
