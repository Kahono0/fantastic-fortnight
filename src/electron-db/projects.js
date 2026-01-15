const db = require("./db");

// window.myappAPI.getAllProjects();
exports.getAllProjects = function () {
  try {
    const stmt = db.prepare("SELECT * FROM projects ORDER BY created_at DESC");
    const rows = stmt.all();
    return rows;
  } catch (err) {
    console.error("[electron-db] getAllProjects error", err);
    return [];
  }
};

// window.myappAPI.createProject(name, description);
exports.createProject = function (name, description) {
  try {
    const created = new Date().toISOString();
    const insert = db.prepare(
      "INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    const info = insert.run(name, description, created, created);
    if (info.changes) {
      const stmt = db.prepare("SELECT * FROM projects WHERE id = ?");
      const row = stmt.get(info.lastInsertRowid);
      return row;
    }
    return null;
  } catch (err) {
    console.error("[electron-db] createProject error", err);
    return null;
  }
};
