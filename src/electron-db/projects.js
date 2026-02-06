const db = require('./db')

function now() { return new Date().toISOString() }

function rowToProject(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    archived: !!row.archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function getAllProjects() {
  const stmt = db.prepare('SELECT * FROM projects ORDER BY created_at DESC, id DESC')
  const rows = stmt.all()
  return rows.map(rowToProject)
}

function createProject(name, description) {
  const stmt = db.prepare('INSERT INTO projects (name, description, archived, created_at) VALUES (?, ?, 0, ?)')
  const info = stmt.run(name, description || null, now())
  const get = db.prepare('SELECT * FROM projects WHERE id = ?')
  return rowToProject(get.get(info.lastInsertRowid))
}

function archiveProject(id, archived) {
  const stmt = db.prepare('UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?')
  stmt.run(archived ? 1 : 0, now(), id)
  const get = db.prepare('SELECT * FROM projects WHERE id = ?')
  return rowToProject(get.get(id))
}

function deleteProject(id) {
  const stmt = db.prepare('DELETE FROM projects WHERE id = ?')
  const info = stmt.run(id)
  return info.changes > 0
}

module.exports = { getAllProjects, createProject, archiveProject, deleteProject }

