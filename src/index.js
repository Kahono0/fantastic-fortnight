const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require("path");
const fs = require('fs')
const xlsx = require('xlsx')

// Load DB-backed modules
const fieldsDb = require("./electron-db/fields");
const issuesDb = require("./electron-db/issues");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
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

ipcMain.handle("uploadStaticFieldsToSupabase", async (_event, fieldsData) => {
  try {
    return fieldsDb.uploadStaticFieldsToSupabase(fieldsData);
  } catch (err) {
    console.error("[main] uploadStaticFieldsToSupabase", err);
  }
});

// Issues
ipcMain.handle("getAllIssues", async () => {
  try {
    return issuesDb.getAllIssues();
  } catch (err) {
    console.error("[main] getAllIssues", err);
    return [];
  }
});

ipcMain.handle("createIssue", async (_event, issueData) => {
  try {
    return issuesDb.createIssue(issueData);
  } catch (err) {
    console.error("[main] createIssue", err);
    return null;
  }
});

ipcMain.handle("getIssueById", async (_event, id) => {
  try {
    return issuesDb.getIssueById(id);
  } catch (err) {
    console.error("[main] getIssueById", err);
    return null;
  }
});


ipcMain.handle('queryIssues', async (_event, filters) => {
  try {
    return issuesDb.queryIssues(filters)
  } catch (err) {
    console.error('[main] queryIssues', err)
    return []
  }
})

ipcMain.handle('selectFolder', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (result.canceled) return null
    return Array.isArray(result.filePaths) && result.filePaths.length > 0 ? result.filePaths[0] : null
  } catch (err) {
    console.error('[main] selectFolder', err)
    return null
  }
})


// Choose an Excel file on disk (returns path or null)
ipcMain.handle('selectExcelFile', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] },
      ],
    })
    if (result.canceled) return null
    return Array.isArray(result.filePaths) && result.filePaths.length > 0 ? result.filePaths[0] : null
  } catch (err) {
    console.error('[main] selectExcelFile', err)
    return null
  }
})

ipcMain.handle('previewExcel', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') throw new Error('Invalid file path')
    const buf = fs.readFileSync(filePath)
    const workbook = xlsx.read(buf, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null })
    const headers = rows && rows.length > 0 ? Object.keys(rows[0]) : []
    const sample = rows.slice(0, 5)
    return { headers, sample }
  } catch (err) {
    console.error('[main] previewExcel', err)
    return { headers: [], sample: [], error: String(err) }
  }
})

// Import Excel file: parse and create issues in the local DB. Returns { imported: n, errors: [...] }
// Import Excel file: parse and create issues in the local DB. Returns { imported: n, errors: [...] }
// Accepts optional mapping: { [headerName]: destinationFieldName | "" }
ipcMain.handle('importExcel', async (_event, filePath, mapping) => {
  try {
    if (!filePath || typeof filePath !== 'string') throw new Error('Invalid file path')

    // Read file buffer
    const buf = fs.readFileSync(filePath)

    // Parse with SheetJS
    const workbook = xlsx.read(buf, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null })
    console.log(JSON.stringify(rows, null, 2))
    const summary = { imported: 0, errors: [] }

    for (const [i, row] of rows.entries()) {
      try {
        // Build issueData using mapping if provided, otherwise copy all columns with normalized keys
        const issueData = {}
        if (mapping && typeof mapping === 'object') {
          // Build a normalized lookup map for this row so header variations map to the actual value.
          // Use a single normalization function for keys so mapping lookup is stable.
          const normalizeKey = (s = "") =>
            String(s || "")
              .replace(/\uFEFF/g, '') // remove BOM
              .replace(/\r\n|\r|\n/g, ' ') // normalize newlines to spaces
              .trim()
              .toLowerCase()
              .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
              .replace(/[^a-z0-9]+/g, '_')

          const normalizedRowMap = new Map()
          for (const origKey of Object.keys(row)) {
            const val = row[origKey]
            const norm = normalizeKey(origKey)
            // store both normalized and trimmed forms to maximize hit rate
            normalizedRowMap.set(norm, val)
            normalizedRowMap.set(String(origKey).trim().toLowerCase(), val)
            normalizedRowMap.set(String(origKey), val)
          }

          for (const [hdr, dest] of Object.entries(mapping)) {
            if (!dest) continue
            const hdrNorm = normalizeKey(hdr)
            const hdrTrim = String(hdr).trim().toLowerCase()
            let val = undefined
            if (normalizedRowMap.has(hdrNorm)) val = normalizedRowMap.get(hdrNorm)
            else if (normalizedRowMap.has(hdrTrim)) val = normalizedRowMap.get(hdrTrim)
            else if (normalizedRowMap.has(hdr)) val = normalizedRowMap.get(hdr)
            else {
              // fallback: try alternate transforms
              const alt = String(hdr).replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase()
              const alt2 = alt.replace(/\s+/g, '_')
              if (normalizedRowMap.has(alt)) val = normalizedRowMap.get(alt)
              else if (normalizedRowMap.has(alt2)) val = normalizedRowMap.get(alt2)
            }
            issueData[dest] = val
          }
        } else {
          for (const key of Object.keys(row)) {
            const k = String(key).trim()
            if (!k) continue
            const nk = k.replace(/\s+/g, '_').toLowerCase()
            issueData[nk] = row[key]
          }
        }

        // Create issue in local DB
        await issuesDb.createIssue(issueData)
        summary.imported += 1
      } catch (err) {
        console.error('[main] importExcel row error', err)
        summary.errors.push({ row: i + 1, error: String(err) })
      }
    }

    return summary
  } catch (err) {
    console.error('[main] importExcel', err)
    return { imported: 0, errors: [{ error: String(err) }] }
  }
})

