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
  deleteField: (id) => ipcRenderer.invoke("deleteField", id),
  saveFieldVisibility: (id, visible) =>
    ipcRenderer.invoke("saveFieldVisibility", id, visible),
  uploadStaticFieldsToSupabase: (fieldsData) =>
    ipcRenderer.invoke("uploadStaticFieldsToSupabase", fieldsData),

  // Issues
  getAllIssues: (projectId) => ipcRenderer.invoke("getAllIssues", projectId),
  createIssue: (projectId, issueData) =>
    ipcRenderer.invoke("createIssue", projectId, issueData),
  // window.myappAPI.updateIssue(issueId, issueData)
  updateIssue: (issueId, issueData) =>
    ipcRenderer.invoke("updateIssue", issueId, issueData),
  getIssueById: (id) => ipcRenderer.invoke("getIssueById", id),
  queryIssues: (projectId, filters) =>
    ipcRenderer.invoke("queryIssues", projectId, filters),

  // window.myappAPI.createProject(name, description);
  createProject: (name, description) =>
    ipcRenderer.invoke("createProject", name, description),
  getAllProjects: () => ipcRenderer.invoke("getAllProjects"),
  selectFolder: () => ipcRenderer.invoke("selectFolder"),
    selectImageFile: () => ipcRenderer.invoke("selectImageFile"),
  selectExcelFile: () => ipcRenderer.invoke("selectExcelFile"),
  previewExcel: (filePath) => ipcRenderer.invoke("previewExcel", filePath),
  // Import and process an Excel file on the main process (returns summary)
  importExcel: (projectId, filePath, mapping) =>
    ipcRenderer.invoke("importExcel", projectId, filePath, mapping),
  listPhotos: (dirPath) => ipcRenderer.invoke("listPhotos", dirPath),
    exportPdf: () => ipcRenderer.invoke('exportPdf'),
    printToPDF: (options) => ipcRenderer.invoke('printToPDF', options),
};

contextBridge.exposeInMainWorld("myappAPI", myappAPI);

// Optionally export for require() callers in tests or debug contexts
module.exports = myappAPI;
