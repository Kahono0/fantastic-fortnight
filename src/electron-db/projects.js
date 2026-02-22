const db = require("./db");

function now() {
  return new Date().toISOString();
}

function rowToProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    archived: !!row.archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

exports.getAllProjects = function () {
  const stmt = db.prepare(
    "SELECT * FROM projects ORDER BY created_at DESC, id DESC",
  );
  const rows = stmt.all();
  return rows.map(rowToProject);
};

exports.createProject = function (name, description) {
  const stmt = db.prepare(
    "INSERT INTO projects (name, description, archived, created_at) VALUES (?, ?, 0, ?)",
  );
  const info = stmt.run(name, description || null, now());
  const get = db.prepare("SELECT * FROM projects WHERE id = ?");
  return rowToProject(get.get(info.lastInsertRowid));
};

exports.archiveProject = function (id, archived) {
  const stmt = db.prepare(
    "UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?",
  );
  stmt.run(archived ? 1 : 0, now(), id);
  const get = db.prepare("SELECT * FROM projects WHERE id = ?");
  return rowToProject(get.get(id));
};

exports.deleteProject = function (id) {
  const stmt = db.prepare("DELETE FROM projects WHERE id = ?");
  const info = stmt.run(id);
  return info.changes > 0;
};

// ALTER TABLE projects ADD COLUMN current_active INTEGER DEFAULT 0;
exports.setCurrentActiveProject = function (id) {
  const unsetStmt = db.prepare(
    "UPDATE projects SET current_active = 0 WHERE current_active = 1",
  );
  unsetStmt.run();
  const setStmt = db.prepare(
    "UPDATE projects SET current_active = 1, updated_at = ? WHERE id = ?",
  );
  setStmt.run(now(), id);
  const get = db.prepare("SELECT * FROM projects WHERE id = ?");
  return rowToProject(get.get(id));
};

exports.getCurrentActiveProject = function () {
  const stmt = db.prepare("SELECT * FROM projects WHERE current_active = 1");
  return rowToProject(stmt.get());
};

exports.closeCurrentActiveProject = function () {
  const unsetStmt = db.prepare(
    "UPDATE projects SET current_active = 0 WHERE current_active = 1",
  );
  unsetStmt.run();
  return true;
};

//module.exports = { getAllProjects, createProject, archiveProject, deleteProject, setCurrentActiveProject, getCurrentActiveProject, closeCurrentActiveProject }
