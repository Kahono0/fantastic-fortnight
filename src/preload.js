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
     createIssue: (projectId, issueData, recordId) => ipcRenderer.invoke('createIssue', projectId, issueData, recordId),
  // window.myappAPI.updateIssue(issueId, issueData)
    updateIssue: (id, patch) => ipcRenderer.invoke('updateIssue', id, patch),
  deleteIssue: (id) => ipcRenderer.invoke('deleteIssue', id),
  getIssueById: (id) => ipcRenderer.invoke("getIssueById", id),
  queryIssues: (projectId, filters) =>
    ipcRenderer.invoke("queryIssues", projectId, filters),

  // window.myappAPI.createProject(name, description);
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

    getAllProjects: () => ipcRenderer.invoke('getAllProjects'),
  createProject: (name, description) => ipcRenderer.invoke('createProject', name, description),
  archiveProject: (id, archived) => ipcRenderer.invoke('archiveProject', id, archived),
  deleteProject: (id) => ipcRenderer.invoke('deleteProject', id),

    // Defects
  getDefects: (projectId) => ipcRenderer.invoke('getDefects', projectId),
  saveDefect: (projectId, defect) => ipcRenderer.invoke('saveDefect', projectId, defect),
  deleteDefect: (projectId, id) => ipcRenderer.invoke('deleteDefect', projectId, id),

      // Records
  getRecords: (projectId) => ipcRenderer.invoke('getRecords', projectId),
  createRecord: (projectId, title) => ipcRenderer.invoke('createRecord', projectId, title),
  updateRecord: (recordId, patch) => ipcRenderer.invoke('updateRecord', recordId, patch),
  deleteRecord: (projectId, recordId) => ipcRenderer.invoke('deleteRecord', projectId, recordId),

  // Pick photos via open dialog
  pickPhotos: () => ipcRenderer.invoke('pickPhotos'),
  // Copy photos to persistent app folder scoped to record
  copyPhotos: (recordId, filePaths) => ipcRenderer.invoke('copyPhotos', recordId, filePaths),
};

contextBridge.exposeInMainWorld("myappAPI", myappAPI);

// Optionally export for require() callers in tests or debug contexts
module.exports = myappAPI;
