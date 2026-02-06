const db = require("./db");

function nowISO() {
  return new Date().toISOString();
}

function parseRecordRow(row) {
  if (!row) return null;
  let comments = [];
  try {
    comments = JSON.parse(row.comments);
    if (!Array.isArray(comments)) comments = [];
  } catch {
    comments = [];
  }
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    comments,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

exports.getRecords = function (projectId) {
  try {
    if (projectId == null) return [];
    const stmt = db.prepare(
      "SELECT * FROM records WHERE project_id = ? ORDER BY created_at DESC",
    );
    const rows = stmt.all(projectId);
    return rows.map(parseRecordRow).filter(Boolean);
  } catch (err) {
    console.error("[electron-db] getRecords error", err);
    return [];
  }
};

exports.createRecord = function (projectId, title) {
  try {
    if (projectId == null) throw new Error("Invalid projectId");
    const now = nowISO();
    const commentsJson = JSON.stringify([]);
    const ins = db.prepare(
      "INSERT INTO records (project_id, title, comments, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    const info = ins.run(projectId, title, commentsJson, now, now);
    if (info.changes) {
      const id = info.lastInsertRowid;
      const row = db.prepare("SELECT * FROM records WHERE id = ?").get(id);
      return parseRecordRow(row);
    }
    return null;
  } catch (err) {
    console.error("[electron-db] createRecord error", err);
    return null;
  }
};

exports.updateRecord = function (recordId, patch) {
  try {
    const existing = db
      .prepare("SELECT * FROM records WHERE id = ?")
      .get(recordId);
    if (!existing) return null;
    const nextTitle = patch.title ?? existing.title;
    const nextComments = Array.isArray(patch.comments)
      ? patch.comments
      : (() => {
          try {
            const a = JSON.parse(existing.comments);
            return Array.isArray(a) ? a : [];
          } catch (e) {
              console.error("Error parsing existing comments:", e);
            return [];
          }
        })();
    const upd = db.prepare(
      "UPDATE records SET title = ?, comments = ?, updated_at = ? WHERE id = ?",
    );
    const info = upd.run(
      nextTitle,
      JSON.stringify(nextComments),
      nowISO(),
      recordId,
    );
    if (info.changes) {
      const row = db
        .prepare("SELECT * FROM records WHERE id = ?")
        .get(recordId);
      return parseRecordRow(row);
    }
    return null;
  } catch (err) {
    console.error("[electron-db] updateRecord error", err);
    return null;
  }
};

exports.deleteRecord = function (projectId, recordId) {
  try {
    if (projectId == null) throw new Error("Invalid projectId");
    const del = db.prepare(
      "DELETE FROM records WHERE id = ? AND project_id = ?",
    );
    const info = del.run(recordId, projectId);
    return info.changes > 0;
  } catch (err) {
    console.error("[electron-db] deleteRecord error", err);
    return false;
  }
};
