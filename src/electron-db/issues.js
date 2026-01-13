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

exports.createIssue = function (issueData) {
  try {
    const id = issueData.id || uuidv4()
    const created = nowISO()
    const dataToStore = Object.assign({}, issueData)
    // Remove id if present in dataToStore to avoid duplication inside JSON
    delete dataToStore.id

    const insert = db.prepare('INSERT INTO issues (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)')
    const info = insert.run(id, JSON.stringify(dataToStore), created, created)
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

  // Build join-based query: join issue_index for each filter and apply condition
  const joins = []
  const params = []
  filters.forEach((f, idx) => {
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

  const sql = `SELECT DISTINCT issues.* FROM issues ${joins.join(' ')} ORDER BY issues.created_at DESC`
    console.log('queryIssues SQL:', sql, 'params:', params)
  const stmt = db.prepare(sql)
  const rows = stmt.all(...params)
  return rows.map(parseIssueRow).filter(Boolean)
}

