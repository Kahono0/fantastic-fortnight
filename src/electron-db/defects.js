const db = require('./db')

function nowISO() {
  return new Date().toISOString()
}

exports.getDefects = function (projectId) {
  try {
    if (projectId == null) return []
    const stmt = db.prepare('SELECT id, project_id, number, description, created_at, updated_at FROM defects WHERE project_id = ? ORDER BY created_at DESC')
    const rows = stmt.all(projectId)
    return rows.map((r) => ({ id: r.id, number: r.number, description: r.description, project_id: r.project_id, created_at: r.created_at, updated_at: r.updated_at }))
  } catch (err) {
    console.error('[electron-db] getDefects error', err)
    return []
  }
}

exports.saveDefect = function (projectId, defect) {
  try {
    if (projectId == null) throw new Error('Invalid projectId')
    const now = nowISO()
    if (defect.id != null) {
      // update existing
      const upd = db.prepare('UPDATE defects SET number = ?, description = ?, updated_at = ? WHERE id = ? AND project_id = ?')
      const info = upd.run(defect.number, defect.description || null, now, Number(defect.id), projectId)
      if (info.changes) {
        const row = db.prepare('SELECT id, project_id, number, description, created_at, updated_at FROM defects WHERE id = ?').get(Number(defect.id))
        return row ? { id: row.id, number: row.number, description: row.description } : null
      }
      return null
    } else {
      // insert new
      const ins = db.prepare('INSERT INTO defects (project_id, number, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      const info = ins.run(projectId, defect.number, defect.description || null, now, now)
      if (info.changes) {
        const id = info.lastInsertRowid
        const row = db.prepare('SELECT id, project_id, number, description, created_at, updated_at FROM defects WHERE id = ?').get(id)
        return row ? { id: row.id, number: row.number, description: row.description } : null
      }
      return null
    }
  } catch (err) {
    console.error('[electron-db] saveDefect error', err)
    return null
  }
}

exports.deleteDefect = function (projectId, id) {
  try {
    if (projectId == null) throw new Error('Invalid projectId')
    const del = db.prepare('DELETE FROM defects WHERE id = ? AND project_id = ?')
    const info = del.run(Number(id), projectId)
    return info.changes > 0
  } catch (err) {
    console.error('[electron-db] deleteDefect error', err)
    return false
  }
}

