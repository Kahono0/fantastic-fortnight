const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");
const { v4: uuidv4 } = require("uuid");

// Load DB-backed modules
const config = require("./config");
const fieldsDb = require("./electron-db/fields");
const issuesDb = require("./electron-db/issues");
const projectsDb = require("./electron-db/projects");
const defectsDb = require("./electron-db/defects");
const recordsDb = require("./electron-db/records");

const IMAGE_EXT_REGEX = /\.(jpe?g|png|gif|heic|webp|tiff?)$/i;

function toPosixPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function stripFileProtocol(p) {
  const raw = String(p || "").trim();
  if (!raw) return "";
  if (raw.startsWith("file://")) {
    const without = raw.replace(/^file:\/\//, "");
    try {
      return decodeURIComponent(without);
    } catch {
      return without;
    }
  }
  return raw;
}

function getHomePath() {
  return path.resolve(app.getPath("home") || "");
}

function getDropboxHomeRoot() {
  return path.resolve(path.join(getHomePath(), "Dropbox"));
}

function getSyncRoot() {
  return path.resolve(config.getDataRoot());
}

function isInsidePath(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolveInputPath(inputPath) {
  let p = stripFileProtocol(inputPath);
  if (!p) return "";

  const home = getHomePath();
  if (p.startsWith("/Dropbox/")) {
    p = path.join(home, p.replace(/^\/+Dropbox\//, "Dropbox/"));
  } else if (/^[A-Za-z]:\\Dropbox\\/i.test(p)) {
    p = path.join(home, "Dropbox", p.replace(/^[A-Za-z]:\\Dropbox\\/i, ""));
  }

  return path.resolve(p);
}

function toHomeRelativeDropboxPath(absPath) {
  const resolved = path.resolve(absPath);
  const home = getHomePath();
  const rel = path.relative(home, resolved);
  return toPosixPath(rel);
}

function toAbsolutePhotoPath(storedPath) {
  const raw = String(storedPath || "").trim();
  if (!raw) return "";

  const stripped = stripFileProtocol(raw);
  if (path.isAbsolute(stripped)) return stripped;

  const home = getHomePath();
  return path.join(home, stripped);
}

function toFileUrl(absPath) {
  if (!absPath) return "";
  return `file://${absPath}`;
}

function listImageFilesInDirectory(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const st = fs.statSync(dirPath);
  if (!st.isDirectory()) return [];

  return fs
    .readdirSync(dirPath)
    .filter((name) => IMAGE_EXT_REGEX.test(name))
    .map((name) => path.join(dirPath, name));
}

function ensureRecordPhotoDir(recordId) {
  const destDir = path.join(getSyncRoot(), "photos", String(recordId));
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  return destDir;
}

function uniqueDestinationPath(destDir, filename) {
  let dest = path.join(destDir, filename);
  if (!fs.existsSync(dest)) return dest;

  const parsed = path.parse(filename);
  return path.join(destDir, `${Date.now()}_${parsed.name}${parsed.ext}`);
}

function ensurePhotoInDropbox(recordId, sourcePath) {
  const source = resolveInputPath(sourcePath);
  if (!source) return null;
  if (!fs.existsSync(source)) return null;

  const dropboxRoot = getDropboxHomeRoot();
  if (isInsidePath(dropboxRoot, source)) {
    // Already synced by Dropbox: do not copy
    return toHomeRelativeDropboxPath(source);
  }

  const destDir = ensureRecordPhotoDir(recordId);
  const dest = uniqueDestinationPath(destDir, path.basename(source));
  fs.copyFileSync(source, dest);
  return toHomeRelativeDropboxPath(dest);
}

function buildIssueDataFromRow(row, mapping) {
  const issueData = {};
  if (!(mapping && typeof mapping === "object")) return issueData;

  const normalizeKey = (s = "") =>
    String(s || "")
      .replace(/\uFEFF/g, "")
      .replace(/\r\n|\r|\n/g, " ")
      .trim()
      .toLowerCase()
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
      .replace(/[^a-z0-9]+/g, "_");

  const normalizedRowMap = new Map();
  for (const origKey of Object.keys(row || {})) {
    const val = row[origKey];
    const norm = normalizeKey(origKey);
    normalizedRowMap.set(norm, val);
    normalizedRowMap.set(String(origKey).trim().toLowerCase(), val);
    normalizedRowMap.set(String(origKey), val);
  }

  for (const [hdr, dest] of Object.entries(mapping)) {
    if (!dest) continue;
    const hdrNorm = normalizeKey(hdr);
    const hdrTrim = String(hdr).trim().toLowerCase();
    let val;

    if (normalizedRowMap.has(hdrNorm)) val = normalizedRowMap.get(hdrNorm);
    else if (normalizedRowMap.has(hdrTrim)) val = normalizedRowMap.get(hdrTrim);
    else if (normalizedRowMap.has(hdr)) val = normalizedRowMap.get(hdr);
    else {
      const alt = String(hdr)
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .toLowerCase();
      const alt2 = alt.replace(/\s+/g, "_");
      if (normalizedRowMap.has(alt)) val = normalizedRowMap.get(alt);
      else if (normalizedRowMap.has(alt2)) val = normalizedRowMap.get(alt2);
    }

    issueData[dest] = val;
  }

  return issueData;
}

function splitInspectionFields(issueData) {
  const inspectorRaw = String(issueData?.inspector || "").trim();
  if (!inspectorRaw) return;
  const parts = inspectorRaw.split(" ");
  if (parts.length < 2) return;
  issueData.inspection_date = parts[0];
  issueData.inspector = parts.slice(1).join(" ");
}

function getDefectInfo(issueData, row) {
  const defectText = String(
    issueData["issue"] || issueData["*Issue"] || row["*Issue"] || row["Issue"] || "",
  ).trim();

  if (!defectText) return { defectNumber: "", defectDescription: "" };

  const parts = defectText.split(/\s+/);
  const defectNumber = parts[0] || "";
  let defectDescription = defectText;
  if (defectNumber && defectDescription.startsWith(defectNumber)) {
    defectDescription = defectDescription.slice(defectNumber.length).trim();
  }

  return { defectNumber, defectDescription };
}

function buildComment(issueData, row, defectNumber) {
  const address = String(issueData["address"] || row["*Address"] || row["Address"] || "").trim();
  const observation = String(issueData["observation"] || row["Observation"] || "").trim();
  return {
    id: uuidv4(),
    address,
    text: observation,
    photos: [],
    defect_number: defectNumber,
  };
}

function getPhotoSourceDir(issueData, row) {
  const raw = String(issueData["photo_path"] || row["Photo Path"] || row["photo_path"] || "").trim();
  if (!raw) return "";
  return resolveInputPath(raw);
}

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

ipcMain.handle(
  "createIssue",
  async (_event, projectId, issueData, recordId) => {
    try {
      return issuesDb.createIssue(projectId, issueData, recordId);
    } catch (err) {
      console.error("[main] createIssue", err);
      return null;
    }
  },
);

ipcMain.handle("updateIssue", async (_event, id, patch) => {
  try {
    return issuesDb.updateIssue(id, patch);
  } catch (err) {
    console.error("[main] updateIssue", err);
    return null;
  }
});

ipcMain.handle("deleteIssue", async (_event, id) => {
  try {
    return issuesDb.deleteIssue(id);
  } catch (err) {
    console.error("[main] deleteIssue", err);
    return false;
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

    // Create a record for this import: derive a title from first row
    let recordId = null;
    try {
      const first = rows[0] || {};
      const derive = (row) => {
        // Extract combined date/inspector if present
        const combinedKeys = Object.keys(row || {});
        const combinedVal = combinedKeys.find(
          (k) => /inspection.*date/i.test(k) && /inspector/i.test(k),
        );
        let dt = "",
          insp = "";
        if (combinedVal) {
          const raw = String(row[combinedVal] || "");
          const m = raw.match(/(\d{4}-\d{2}-\d{2})\s+(.*)/);
          if (m) {
            dt = m[1];
            insp = m[2];
          }
        }
        const addr = String(row["*Address"] || row["Address"] || "").trim();
        const title =
          dt || insp
            ? `Import ${dt}${insp ? " " + insp : ""}${addr ? " — " + addr : ""}`
            : `Import ${new Date().toISOString().slice(0, 10)}`;
        return title;
      };
      const title = derive(first);
      const rec = recordsDb.createRecord(projectId, title);
      recordId = rec?.id ?? rec;
    } catch (err) {
      console.error("[main] importExcel createRecord error", err);
    }

    // Accumulate comments and defects
    const comments = [];

    for (const [i, row] of rows.entries()) {
      try {
        const issueData = buildIssueDataFromRow(row, mapping);

        // if all fields missing, skip
        const allMissing = Object.values(issueData).every(
          (v) => v == null || String(v).trim() === "",
        );
        if (allMissing) continue;

        splitInspectionFields(issueData);
        const { defectNumber, defectDescription } = getDefectInfo(issueData, row);
        const comment = buildComment(issueData, row, defectNumber);

        // Process photos from source directory and store Dropbox-relative paths
        try {
          const sourceDir = getPhotoSourceDir(issueData, row);
          if (recordId && sourceDir) {
            const files = listImageFilesInDirectory(sourceDir);
            for (const src of files) {
              try {
                const stored = ensurePhotoInDropbox(recordId, src);
                if (stored) comment.photos.push(stored);
              } catch (copyErr) {
                console.error("[main] importExcel copy photo error", copyErr);
              }
            }
          }
        } catch (err) {
          console.error("[main] importExcel photo handling", err);
        }

        if (defectNumber) {
          //if (!defectMap.has(defectNumber)) defectMap.set(defectNumber, defectDescription)
          const savedDefect = defectsDb.saveDefect(projectId, {
            number: defectNumber,
            description: defectDescription,
          });

          const updatedComment = { ...comment, issueId: savedDefect.id };
          comments.push(updatedComment);
        }

        // Create issue in local DB with project scope and link to record
        await issuesDb.createIssue(projectId, issueData, recordId || null);
        summary.imported += 1;
      } catch (err) {
        console.error("[main] importExcel row error", err);
        summary.errors.push({ row: i + 1, error: String(err) });
      }
    }

    try {
      if (recordId) {
        recordsDb.updateRecord(recordId, { comments: comments });
      } else {
        console.warn("[importExcel] no recordId to update comments");
      }
    } catch (err) {
      console.error("[main] importExcel updateRecord comments error", err);
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
    const filename =
      options && options.filename ? options.filename : "report.pdf";
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

ipcMain.handle("getAllProjects", async () => {
  try {
    return projectsDb.getAllProjects();
  } catch (err) {
    console.error("[main] getAllProjects", err);
    return [];
  }
});

ipcMain.handle("createProject", async (_event, name, description) => {
  try {
    if (!name || typeof name !== "string") throw new Error("Invalid name");
    return projectsDb.createProject(name, description);
  } catch (err) {
    console.error("[main] createProject", err);
    return null;
  }
});

ipcMain.handle("archiveProject", async (_event, id, archived) => {
  try {
    if (id == null) throw new Error("Invalid id");
    return projectsDb.archiveProject(id, !!archived);
  } catch (err) {
    console.error("[main] archiveProject", err);
    return null;
  }
});

ipcMain.handle("deleteProject", async (_event, id) => {
  try {
    if (id == null) throw new Error("Invalid id");
    return projectsDb.deleteProject(id);
  } catch (err) {
    console.error("[main] deleteProject", err);
    return false;
  }
});

// setCurrentActiveProject, getCurrentActiveProject, closeCurrentActiveProject
ipcMain.handle("setCurrentActiveProject", async (_event, id) => {
  try {
    if (id == null) throw new Error("Invalid id");
    return projectsDb.setCurrentActiveProject(id);
  } catch (err) {
    console.error("[main] setCurrentActiveProject", err);
    return null;
  }
});

ipcMain.handle("getCurrentActiveProject", async () => {
  try {
    return projectsDb.getCurrentActiveProject();
  } catch (err) {
    console.error("[main] getCurrentActiveProject", err);
    return null;
  }
});

ipcMain.handle("closeCurrentActiveProject", async () => {
  try {
    return projectsDb.closeCurrentActiveProject();
  } catch (err) {
    console.error("[main] closeCurrentActiveProject", err);
    return false;
  }
});


// Defects IPC
ipcMain.handle("getDefects", async (_event, projectId) => {
  try {
    return defectsDb.getDefects(projectId);
  } catch (err) {
    console.error("[main] getDefects", err);
    return [];
  }
});

ipcMain.handle("saveDefect", async (_event, projectId, defect) => {
  try {
    return defectsDb.saveDefect(projectId, defect);
  } catch (err) {
    console.error("[main] saveDefect", err);
    return null;
  }
});

ipcMain.handle("deleteDefect", async (_event, projectId, id) => {
  try {
    return defectsDb.deleteDefect(projectId, id);
  } catch (err) {
    console.error("[main] deleteDefect", err);
    return false;
  }
});

// Records IPC
ipcMain.handle("getRecords", async (_event, projectId) => {
  try {
    const records = recordsDb.getRecords(projectId);
    return records.map((record) => {
      const comments = Array.isArray(record?.comments)
        ? record.comments.map((comment) => {
            const photos = Array.isArray(comment?.photos)
              ? comment.photos.map((p) => {
                  const abs = toAbsolutePhotoPath(p);
                  return abs ? toFileUrl(abs) : p;
                })
              : [];
            return { ...comment, photos };
          })
        : [];
      return { ...record, comments };
    });
  } catch (err) {
    console.error("[main] getRecords", err);
    return [];
  }
});

ipcMain.handle("createRecord", async (_event, projectId, title) => {
  try {
    return recordsDb.createRecord(projectId, title);
  } catch (err) {
    console.error("[main] createRecord", err);
    return null;
  }
});

ipcMain.handle("updateRecord", async (_event, recordId, patch) => {
  try {
    return recordsDb.updateRecord(recordId, patch);
  } catch (err) {
    console.error("[main] updateRecord", err);
    return null;
  }
});

ipcMain.handle("deleteRecord", async (_event, projectId, recordId) => {
  try {
    return recordsDb.deleteRecord(projectId, recordId);
  } catch (err) {
    console.error("[main] deleteRecord", err);
    return false;
  }
});

// Pick photos via open dialog (multiple)
ipcMain.handle("pickPhotos", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: [
            "jpg",
            "jpeg",
            "png",
            "gif",
            "heic",
            "webp",
            "tif",
            "tiff",
          ],
        },
      ],
    });
    if (result.canceled) return [];
    return Array.isArray(result.filePaths) ? result.filePaths : [];
  } catch (err) {
    console.error("[main] pickPhotos", err);
    return [];
  }
});

// Copy photos when needed and return Dropbox-relative paths
ipcMain.handle("copyPhotos", async (_event, recordId, filePaths) => {
  try {
    if (!recordId) throw new Error("Invalid recordId");
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];

    const stored = [];
    for (const src of filePaths) {
      if (!src || typeof src !== "string") continue;
      try {
        const rel = ensurePhotoInDropbox(recordId, src);
        if (rel) stored.push(rel);
      } catch (err) {
        console.error("[main] copyPhotos item error", err);
      }
    }
    return stored;
  } catch (err) {
    console.error("[main] copyPhotos", err);
    return [];
  }
});

// Sync root config IPC
ipcMain.handle("getSyncRoot", async () => {
  try {
    return config.getSyncRoot();
  } catch (err) {
    console.error("[main] getSyncRoot", err);
    return null;
  }
});

ipcMain.handle("setSyncRoot", async (_event, p) => {
  try {
    return config.setSyncRoot(p);
  } catch (err) {
    console.error("[main] setSyncRoot", err);
    return false;
  }
});

// Synchronous getter for preload path resolution
ipcMain.on("getSyncRootSync", (event) => {
  try {
    event.returnValue = config.getSyncRoot();
  } catch (err) {
    console.error("[main] getSyncRootSync", err);
    event.returnValue = null;
  }
});

ipcMain.handle("resolvePhotoPath", async (_event, relPath) => {
    try {
      if (!relPath) return null
      const raw = String(relPath)
      if (!raw) return null

      if (raw.startsWith('file://')) return raw

      const pathMod = path
      if (pathMod.isAbsolute(raw)) return `file://${raw}`

        const home = app.getPath('home') || ''
      if (raw.startsWith('Dropbox/')) {
        const fullDropbox = pathMod.join(home, raw)
        return `file://${fullDropbox}`
      }

      const root = ipcRenderer.sendSync('getSyncRootSync')
      if (!root) return null
      const full = pathMod.join(root, raw)
      return `file://${full}`
    } catch (err) {
      console.error('[preload] resolvePhotoPath error', err)
      return null
    }
});
