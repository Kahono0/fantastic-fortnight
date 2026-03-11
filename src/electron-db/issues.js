const db = require('./db')
const { v4: uuidv4 } = require('uuid')

function nowISO() {
  return new Date().toISOString()
}

function parseIssueRow(row) {
  if (!row) return null
  try {
    const obj = JSON.parse(row.data)
    // ensure id and timestamps are present
    obj.id = row.id
    obj.record_id = row.record_id || null
    obj.project_id = row.project_id || null
    obj.created_at = row.created_at
    obj.updated_at = row.updated_at
    return obj
  } catch (err) {
    console.error('[electron-db] parseIssueRow error', err)
    return null
  }
}

exports.getAllIssues = function () {
  // Use queryIssues with no filters for a consistent path
  return exports.queryIssues([])
}

exports.createIssue = function (projectId, issueData, recordIdParam) {
  try {
    const id = issueData.id || uuidv4()
    const created = nowISO()
    const dataToStore = Object.assign({}, issueData)
    const recordIdFromData = dataToStore.record_id != null ? String(dataToStore.record_id) : null
    const recordId = recordIdParam != null ? String(recordIdParam) : recordIdFromData
    const projectIdVal = projectId != null ? Number(projectId) : null
    // Remove id if present in dataToStore to avoid duplication inside JSON
    delete dataToStore.id
    delete dataToStore.record_id
    delete dataToStore.project_id

    const insert = db.prepare('INSERT INTO issues (id, record_id, project_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    const info = insert.run(id, recordId, projectIdVal, JSON.stringify(dataToStore), created, created)
    if (info.changes) {
      // index dynamic fields for filtering
      try {
        exports.indexIssue(id, dataToStore, created)
      } catch (err) {
        console.error('[electron-db] indexIssue error', err)
      }

      const stored = db.prepare('SELECT * FROM issues WHERE id = ?').get(id)
      return parseIssueRow(stored)
    }
    return null
  } catch (err) {
    console.error('[electron-db] createIssue error', err)
    return null
  }
}

exports.getIssueById = function (issueId) {
  const stmt = db.prepare('SELECT * FROM issues WHERE id = ?')
  const row = stmt.get(issueId)
  return parseIssueRow(row)
}

// Index a single issue's dynamic fields into issue_index table. Overwrites existing entries.
exports.indexIssue = function (issueId, issueData, timestamp) {
  const now = timestamp || nowISO()

  // Remove any previous index rows for this issue
  const del = db.prepare('DELETE FROM issue_index WHERE issue_id = ?')
  del.run(issueId)

  const insert = db.prepare('INSERT INTO issue_index (issue_id, field_name, value_text, value_number, value_date) VALUES (@issue_id, @field_name, @value_text, @value_number, @value_date)')
  const insertMany = db.transaction((entries) => {
    for (const e of entries) insert.run(e)
  })

  const entries = []
  for (const [key, val] of Object.entries(issueData)) {
    if (val === undefined || val === null) continue
    const entry = { issue_id: issueId, field_name: key, value_text: null, value_number: null, value_date: null }

    if (typeof val === 'number') {
      entry.value_number = val
      entry.value_text = String(val)
    } else if (typeof val === 'boolean') {
      entry.value_number = val ? 1 : 0
      entry.value_text = val ? '1' : '0'
    } else if (Object.prototype.toString.call(val) === '[object Date]' || !isNaN(Date.parse(String(val)))) {
      // store as date string
      entry.value_date = new Date(val).toISOString()
      entry.value_text = String(val)
    } else if (Array.isArray(val) || typeof val === 'object') {
      entry.value_text = JSON.stringify(val)
    } else {
      entry.value_text = String(val)
    }

    entries.push(entry)
  }

  if (entries.length > 0) insertMany(entries)
}

// Filters format: [{ field: string, op: 'eq'|'contains'|'lt'|'gt'|'lte'|'gte'|'in', value: any }, ...]
exports.queryIssues = function (filters) {
  if (!filters || filters.length === 0) {
    const stmt = db.prepare('SELECT * FROM issues ORDER BY created_at DESC')
    const rows = stmt.all()
    return rows.map(parseIssueRow).filter(Boolean)
  }

  function isDateLike(v) {
    if (v === null || v === undefined) return false
    // Don't treat plain numbers as dates (they are numeric filters)
    if (typeof v === 'number') return false
    const parsed = Date.parse(String(v))
    return !isNaN(parsed)
  }

  // Build join-based query: join issue_index for each non-column filter and apply condition
  const joins = []
  const params = []
  const whereClauses = []

  const remainingFilters = []
  for (const f of filters) {
    if (f.field === 'record_id') {
      if (f.op === 'eq') {
        if (f.value === null || f.value === undefined) {
          whereClauses.push('issues.record_id IS NULL')
        } else {
          whereClauses.push('issues.record_id = ?')
          params.push(String(f.value))
        }
      } else if (f.op === 'in' && Array.isArray(f.value)) {
        const placeholders = f.value.map(() => '?').join(',')
        whereClauses.push(`issues.record_id IN (${placeholders})`)
        f.value.forEach((v) => params.push(String(v)))
      } else if (f.op === 'contains') {
        whereClauses.push('issues.record_id LIKE ?')
        params.push(`%${String(f.value)}%`)
      } else {
        // unsupported op -> ignore
      }
    } else if (f.field === 'project_id') {
      if (f.op === 'eq') {
        if (f.value === null || f.value === undefined) {
          whereClauses.push('issues.project_id IS NULL')
        } else {
          whereClauses.push('issues.project_id = ?')
          params.push(Number(f.value))
        }
      } else if (f.op === 'in' && Array.isArray(f.value)) {
        const placeholders = f.value.map(() => '?').join(',')
        whereClauses.push(`issues.project_id IN (${placeholders})`)
        f.value.forEach((v) => params.push(Number(v)))
      } else {
        // unsupported ops for project_id -> ignore
      }
    } else {
      remainingFilters.push(f)
    }
  }

  remainingFilters.forEach((f, idx) => {
    const alias = `idx${idx}`
    joins.push(`JOIN issue_index ${alias} ON ${alias}.issue_id = issues.id AND ${alias}.field_name = ?`)
    params.push(f.field)

    // condition appended to join
    let cond = ''
    if (f.op === 'eq') {
      // match text, number or date
      cond = `(${alias}.value_text = ? OR ${alias}.value_number = ? OR ${alias}.value_date = ?)`
      const dateParam = isDateLike(f.value) ? new Date(f.value).toISOString() : null
      params.push(String(f.value), typeof f.value === 'number' ? f.value : null, dateParam)
    } else if (f.op === 'contains') {
      cond = `${alias}.value_text LIKE ?`
      params.push(`%${String(f.value)}%`)
    } else if (f.op === 'lt' || f.op === 'gt' || f.op === 'lte' || f.op === 'gte') {
      const opSql = f.op === 'lt' ? '<' : f.op === 'gt' ? '>' : f.op === 'lte' ? '<=' : '>='
      if (isDateLike(f.value)) {
        // compare ISO date strings lexicographically
        cond = `${alias}.value_date ${opSql} ?`
        params.push(new Date(f.value).toISOString())
      } else {
        cond = `${alias}.value_number ${opSql} ?`
        params.push(Number(f.value))
      }
    } else if (f.op === 'in' && Array.isArray(f.value)) {
      // support arrays of dates or texts
      if (f.value.every((v) => isDateLike(v))) {
        const placeholders = f.value.map(() => '?').join(',')
        cond = `${alias}.value_date IN (${placeholders})`
        f.value.forEach((v) => params.push(new Date(v).toISOString()))
      } else {
        const placeholders = f.value.map(() => '?').join(',')
        cond = `${alias}.value_text IN (${placeholders})`
        f.value.forEach((v) => params.push(String(v)))
      }
    } else {
      // fallback to equality on text
      cond = `${alias}.value_text = ?`
      params.push(String(f.value))
    }

    // append condition to join using AND
    joins[joins.length - 1] = joins[joins.length - 1] + ` AND (${cond})`
  })

  const sql = `SELECT DISTINCT issues.* FROM issues ${joins.join(' ')} ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''} ORDER BY issues.created_at DESC`
  const stmt = db.prepare(sql)
  const rows = stmt.all(...params)
  return rows.map(parseIssueRow).filter(Boolean)
}

// Update an issue: supports changing record_id and data; re-indexes
exports.updateIssue = function (issueId, patch) {
  try {
    const existing = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId)
    if (!existing) return null

    const currentData = JSON.parse(existing.data)
    const newData = Object.assign({}, currentData)

    let newRecordId = existing.record_id || null
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'record_id')) {
      newRecordId = patch.record_id != null ? String(patch.record_id) : null
    }

    let newProjectId = existing.project_id || null
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'project_id')) {
      newProjectId = patch.project_id != null ? Number(patch.project_id) : null
    }

    const dataPatch = Object.assign({}, patch)
    delete dataPatch.id
    delete dataPatch.record_id
    delete dataPatch.project_id

    for (const [k, v] of Object.entries(dataPatch)) {
      if (v === undefined) continue
      newData[k] = v
    }

    const updatedAt = nowISO()
    const upd = db.prepare('UPDATE issues SET record_id = ?, project_id = ?, data = ?, updated_at = ? WHERE id = ?')
    const info = upd.run(newRecordId, newProjectId, JSON.stringify(newData), updatedAt, issueId)
    if (info.changes) {
      try {
        exports.indexIssue(issueId, newData, updatedAt)
      } catch (err) {
        console.error('[electron-db] indexIssue error on update', err)
      }
      const stored = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId)
      return parseIssueRow(stored)
    }
    return null
  } catch (err) {
    console.error('[electron-db] updateIssue error', err)
    return null
  }
}

exports.deleteIssue = function (issueId) {
  try {
    const delIdx = db.prepare('DELETE FROM issue_index WHERE issue_id = ?')
    delIdx.run(issueId)
    const del = db.prepare('DELETE FROM issues WHERE id = ?')
    const info = del.run(issueId)
    return info.changes > 0
  } catch (err) {
    console.error('[electron-db] deleteIssue error', err)
    return false
  }
}

