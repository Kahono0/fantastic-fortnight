const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");

// Load DB-backed modules
const fieldsDb = require("./electron-db/fields");
const issuesDb = require("./electron-db/issues");
const projectsDb = require("./electron-db/projects");
const defectsDb = require('./electron-db/defects')
const recordsDb = require('./electron-db/records')

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
      icon: path.join(__dirname, "assets", "icon.png"),
  });

  // load out/index.html
  win.loadFile(path.join(__dirname, "out", "index.html"));

  // Open the DevTools.
  //   win.webContents.openDevTools()
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// IPC handlers wiring to sqlite-backed functions
ipcMain.handle("getAllFields", async () => {
  try {
    return fieldsDb.getAllFields();
  } catch (err) {
    console.error("[main] getAllFields", err);
    return [];
  }
});

ipcMain.handle("getStaticFields", async () => {
  try {
    return fieldsDb.getStaticFields();
  } catch (err) {
    console.error("[main] getStaticFields", err);
    return [];
  }
});

ipcMain.handle("getCustomFields", async () => {
  try {
    return fieldsDb.getCustomFields();
  } catch (err) {
    console.error("[main] getCustomFields", err);
    return [];
  }
});

ipcMain.handle("addCustomField", async (_event, field) => {
  try {
    return fieldsDb.addCustomField(field);
  } catch (err) {
    console.error("[main] addCustomField", err);
    return null;
  }
});

ipcMain.handle("deleteField", async (_event, id) => {
  try {
    return fieldsDb.deleteField(id);
  } catch (err) {
    console.error("[main] deleteField", err);
    return false;
  }
});

ipcMain.handle("uploadStaticFieldsToSupabase", async (_event, fieldsData) => {
  try {
    return fieldsDb.uploadStaticFieldsToSupabase(fieldsData);
  } catch (err) {
    console.error("[main] uploadStaticFieldsToSupabase", err);
  }
});

ipcMain.handle("saveFieldVisibility", async (_event, id, visible) => {
  try {
    return fieldsDb.saveFieldVisibility(id, visible);
  } catch (err) {
    console.error("[main] saveFieldVisibility", err);
    return false;
  }
});

// Issues
ipcMain.handle("getAllIssues", async (_event, projectId) => {
  try {
    return issuesDb.getAllIssues(projectId);
  } catch (err) {
    console.error("[main] getAllIssues", err);
    return [];
  }
});

ipcMain.handle('createIssue', async (_event, projectId, issueData, recordId) => {
  try {
    return issuesDb.createIssue(projectId, issueData, recordId)
  } catch (err) {
    console.error('[main] createIssue', err)
    return null
  }
})

ipcMain.handle('updateIssue', async (_event, id, patch) => {
  try {
    return issuesDb.updateIssue(id, patch)
  } catch (err) {
    console.error('[main] updateIssue', err)
    return null
  }
})

ipcMain.handle('deleteIssue', async (_event, id) => {
  try {
    return issuesDb.deleteIssue(id)
  } catch (err) {
    console.error('[main] deleteIssue', err)
    return false
  }
})

ipcMain.handle("getIssueById", async (_event, id) => {
  try {
    return issuesDb.getIssueById(id);
  } catch (err) {
    console.error("[main] getIssueById", err);
    return null;
  }
});

ipcMain.handle("queryIssues", async (_event, projectId, filters) => {
  try {
    return issuesDb.queryIssues(projectId, filters);
  } catch (err) {
    console.error("[main] queryIssues", err);
    return [];
  }
});


ipcMain.handle("selectFolder", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    return Array.isArray(result.filePaths) && result.filePaths.length > 0
      ? result.filePaths[0]
      : null;
  } catch (err) {
    console.error("[main] selectFolder", err);
    return null;
  }
});

ipcMain.handle("selectImageFile", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: ["jpg", "jpeg", "png", "gif", "heic", "webp", "tiff"],
        },
      ],
    });
    if (result.canceled) return null;
    return Array.isArray(result.filePaths) && result.filePaths.length > 0
      ? result.filePaths[0]
      : null;
  } catch (err) {
    console.error("[main] selectImageFile", err);
    return null;
  }
});

// Choose an Excel file on disk (returns path or null)
ipcMain.handle("selectExcelFile", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Excel", extensions: ["xlsx", "xls", "csv"] }],
    });
    if (result.canceled) return null;
    return Array.isArray(result.filePaths) && result.filePaths.length > 0
      ? result.filePaths[0]
      : null;
  } catch (err) {
    console.error("[main] selectExcelFile", err);
    return null;
  }
});

ipcMain.handle("previewExcel", async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== "string")
      throw new Error("Invalid file path");
    const buf = fs.readFileSync(filePath);
    const workbook = xlsx.read(buf, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
    const headers = rows && rows.length > 0 ? Object.keys(rows[0]) : [];
    const sample = rows.slice(0, 5);
    return { headers, sample };
  } catch (err) {
    console.error("[main] previewExcel", err);
    return { headers: [], sample: [], error: String(err) };
  }
});

// Import Excel file: parse and create issues in the local DB. Returns { imported: n, errors: [...] }
// Import Excel file: parse and create issues in the local DB. Returns { imported: n, errors: [...] }
// Accepts optional mapping: { [headerName]: destinationFieldName | "" }
ipcMain.handle("importExcel", async (_event, projectId, filePath, mapping) => {
  try {
    if (!filePath || typeof filePath !== "string")
      throw new Error("Invalid file path");

    // Read file buffer
    const buf = fs.readFileSync(filePath);

    // Parse with SheetJS
    const workbook = xlsx.read(buf, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
    const summary = { imported: 0, errors: [] };

    for (const [i, row] of rows.entries()) {
      try {
        // Build issueData using mapping if provided, otherwise copy all columns with normalized keys
        const issueData = {};
        if (mapping && typeof mapping === "object") {
          // Build a normalized lookup map for this row so header variations map to the actual value.
          // Use a single normalization function for keys so mapping lookup is stable.
          const normalizeKey = (s = "") =>
            String(s || "")
              .replace(/\uFEFF/g, "") // remove BOM
              .replace(/\r\n|\r|\n/g, " ") // normalize newlines to spaces
              .trim()
              .toLowerCase()
              .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
              .replace(/[^a-z0-9]+/g, "_");

          const normalizedRowMap = new Map();
          for (const origKey of Object.keys(row)) {
            const val = row[origKey];
            const norm = normalizeKey(origKey);
            // store both normalized and trimmed forms to maximize hit rate
            normalizedRowMap.set(norm, val);
            normalizedRowMap.set(String(origKey).trim().toLowerCase(), val);
            normalizedRowMap.set(String(origKey), val);
          }

          for (const [hdr, dest] of Object.entries(mapping)) {
            if (!dest) continue;
            const hdrNorm = normalizeKey(hdr);
            const hdrTrim = String(hdr).trim().toLowerCase();
            let val = undefined;
            if (normalizedRowMap.has(hdrNorm))
              val = normalizedRowMap.get(hdrNorm);
            else if (normalizedRowMap.has(hdrTrim))
              val = normalizedRowMap.get(hdrTrim);
            else if (normalizedRowMap.has(hdr)) val = normalizedRowMap.get(hdr);
            else {
              // fallback: try alternate transforms
              const alt = String(hdr)
                .replace(/[^a-zA-Z0-9]+/g, " ")
                .trim()
                .toLowerCase();
              const alt2 = alt.replace(/\s+/g, "_");
              if (normalizedRowMap.has(alt)) val = normalizedRowMap.get(alt);
              else if (normalizedRowMap.has(alt2))
                val = normalizedRowMap.get(alt2);
            }
            issueData[dest] = val;
          }
        } else {
          for (const key of Object.keys(row)) {
            const k = String(key).trim();
            if (!k) continue;
            const nk = k.replace(/\s+/g, "_").toLowerCase();
            issueData[nk] = row[key];
          }
        }

          // go through issueData, if all fields are null/empty, skip
          const allEmpty = Object.values(issueData).every(
            (v) => v === null || v === undefined || v === "",
          );
          if (allEmpty) {
            summary.errors.push({
              row: i + 1,
              error: "All fields are empty, skipping",
            });
            continue;
          }

        // Create issue in local DB
        await issuesDb.createIssue(projectId, issueData);
        summary.imported += 1;
      } catch (err) {
        console.error("[main] importExcel row error", err);
        summary.errors.push({ row: i + 1, error: String(err) });
      }
    }

    return summary;
  } catch (err) {
    console.error("[main] importExcel", err);
    return { imported: 0, errors: [{ error: String(err) }] };
  }
});

ipcMain.handle("listPhotos", async (_event, dirPath) => {
  try {
    if (!dirPath || typeof dirPath !== "string") return [];
    const full = dirPath;
    // Ensure directory exists
    if (!fs.existsSync(full)) return [];
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) return [];

    const entries = fs.readdirSync(full);
    const imageExt = /\.(jpe?g|png|gif|heic|webp|tiff?)$/i;
    const files = entries
      .filter((f) => imageExt.test(f))
      .map((f) => path.join(full, f));

    console.log(JSON.stringify(files, null, 2));
    return files;
  } catch (err) {
    console.error("[main] listPhotos", err);
    return [];
  }
});

ipcMain.handle("printToPDF", async (event, options) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("No focused window to print from");
      const filename = options && options.filename ? options.filename : "report.pdf";
      delete options.filename;
    const pdfOptions = {
      printBackground: true,
      marginsType: 0,
      pageSize: "A4",
      scaleFactor: 200,
      landscape: false,
      ...options,
    };

    const pdfData = await win.webContents.printToPDF(pdfOptions);

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: "Save PDF",
        defaultPath: filename,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) return { success: false };

      fs.writeFileSync(filePath, pdfData);
      return { success: true, filePath };
  } catch (err) {
    console.error("[main] printToPDF", err);
    return null;
  }
});

ipcMain.handle("exportPdf", async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("No active window");

    // Generate PDF buffer from the current renderer contents
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
    });

    // Ask user where to save
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save report as PDF",
      defaultPath: "my_report.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (canceled || !filePath) return { success: false };

    fs.writeFileSync(filePath, pdfBuffer);
    return { success: true, filePath };
  } catch (err) {
    console.error("[main] exportPdf", err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('getAllProjects', async () => {
  try {
    return projectsDb.getAllProjects()
  } catch (err) {
    console.error('[main] getAllProjects', err)
    return []
  }
})

ipcMain.handle('createProject', async (_event, name, description) => {
  try {
    if (!name || typeof name !== 'string') throw new Error('Invalid name')
    return projectsDb.createProject(name, description)
  } catch (err) {
    console.error('[main] createProject', err)
    return null
  }
})

ipcMain.handle('archiveProject', async (_event, id, archived) => {
  try {
    if (id == null) throw new Error('Invalid id')
    return projectsDb.archiveProject(id, !!archived)
  } catch (err) {
    console.error('[main] archiveProject', err)
    return null
  }
})

ipcMain.handle('deleteProject', async (_event, id) => {
  try {
    if (id == null) throw new Error('Invalid id')
    return projectsDb.deleteProject(id)
  } catch (err) {
    console.error('[main] deleteProject', err)
    return false
  }
})


// Defects IPC
ipcMain.handle('getDefects', async (_event, projectId) => {
  try {
    return defectsDb.getDefects(projectId)
  } catch (err) {
    console.error('[main] getDefects', err)
    return []
  }
})

ipcMain.handle('saveDefect', async (_event, projectId, defect) => {
  try {
    return defectsDb.saveDefect(projectId, defect)
  } catch (err) {
    console.error('[main] saveDefect', err)
    return null
  }
})

ipcMain.handle('deleteDefect', async (_event, projectId, id) => {
  try {
    return defectsDb.deleteDefect(projectId, id)
  } catch (err) {
    console.error('[main] deleteDefect', err)
    return false
  }
})

// Records IPC
ipcMain.handle('getRecords', async (_event, projectId) => {
  try {
    return recordsDb.getRecords(projectId)
  } catch (err) {
    console.error('[main] getRecords', err)
    return []
  }
})

ipcMain.handle('createRecord', async (_event, projectId, title) => {
  try {
    return recordsDb.createRecord(projectId, title)
  } catch (err) {
    console.error('[main] createRecord', err)
    return null
  }
})

ipcMain.handle('updateRecord', async (_event, recordId, patch) => {
  try {
    return recordsDb.updateRecord(recordId, patch)
  } catch (err) {
    console.error('[main] updateRecord', err)
    return null
  }
})

ipcMain.handle('deleteRecord', async (_event, projectId, recordId) => {
  try {
    return recordsDb.deleteRecord(projectId, recordId)
  } catch (err) {
    console.error('[main] deleteRecord', err)
    return false
  }
})

// Pick photos via open dialog (multiple)
ipcMain.handle('pickPhotos', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'tif', 'tiff'] }],
    })
    if (result.canceled) return []
    return Array.isArray(result.filePaths) ? result.filePaths : []
  } catch (err) {
    console.error('[main] pickPhotos', err)
    return []
  }
})

// Copy photos to app data folder under photos/<recordId>/ and return file:// paths
ipcMain.handle('copyPhotos', async (_event, recordId, filePaths) => {
  try {
    if (!recordId) throw new Error('Invalid recordId')
    if (!Array.isArray(filePaths) || filePaths.length === 0) return []
    const destDir = path.join(app.getPath('userData') || '.', 'photos', String(recordId))
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

    const copied = []
    for (const src of filePaths) {
      if (!src || typeof src !== 'string') continue
      const base = path.basename(src)
      // Avoid collisions: prefix with timestamp if exists
      let dest = path.join(destDir, base)
      if (fs.existsSync(dest)) {
        const name = path.parse(base).name
        const ext = path.parse(base).ext
        dest = path.join(destDir, `${Date.now()}_${name}${ext}`)
      }
      try {
        fs.copyFileSync(src, dest)
        copied.push(`file://${dest}`)
      } catch (err) {
        console.error('[main] copyPhotos item error', err)
      }
    }
    return copied
  } catch (err) {
    console.error('[main] copyPhotos', err)
    return []
  }
})
