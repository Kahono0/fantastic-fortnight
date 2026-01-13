const db = require('./db')
const { v4: uuidv4 } = require('uuid')

function nowISO() {
  return new Date().toISOString()
}

function rowToField(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    type: row.type,
    required: !!row.required,
    static: !!row.static,
    options: row.options ? JSON.parse(row.options) : undefined,
    placeholder: row.placeholder,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

exports.getAllFields = function () {
  const stmt = db.prepare('SELECT * FROM fields ORDER BY id ASC')
  const rows = stmt.all()
  return rows.map(rowToField)
}

exports.getStaticFields = function () {
  const stmt = db.prepare('SELECT * FROM fields WHERE static = 1 ORDER BY name ASC')
  const rows = stmt.all()
  return rows.map(rowToField)
}

exports.getCustomFields = function () {
  const stmt = db.prepare('SELECT * FROM fields WHERE static = 0 ORDER BY name ASC')
  const rows = stmt.all()
  return rows.map(rowToField)
}

exports.addCustomField = function (field) {
  try {
    const id = uuidv4()
    const created = nowISO()
    const insert = db.prepare(`INSERT INTO fields (id, name, label, type, required, static, options, placeholder, created_at, updated_at)
      VALUES (@id, @name, @label, @type, @required, @static, @options, @placeholder, @created_at, @updated_at)`)

    const info = insert.run({
      id,
      name: field.name,
      label: field.label || field.name,
      type: field.type || 'text',
      required: field.required ? 1 : 0,
      static: 0,
      options: field.options ? JSON.stringify(field.options) : null,
      placeholder: field.placeholder || null,
      created_at: created,
      updated_at: created,
    })

    if (info.changes) {
      return exports.getCustomFieldById(id)
    }

    return null
  } catch (err) {
    console.error('[electron-db] addCustomField error', err)
    return null
  }
}

exports.getCustomFieldById = function (id) {
  const stmt = db.prepare('SELECT * FROM fields WHERE id = ?')
  const row = stmt.get(id)
  return rowToField(row)
}

exports.uploadStaticFieldsToSupabase = function (fieldsData) {
  // In Electron/sqlite mode this will create or update static fields locally
  const upsert = db.prepare(`INSERT INTO fields (id, name, label, type, required, static, options, placeholder, created_at, updated_at)
    VALUES (@id, @name, @label, @type, @required, @static, @options, @placeholder, @created_at, @updated_at)
    ON CONFLICT(name) DO UPDATE SET label=excluded.label, type=excluded.type, required=excluded.required, static=excluded.static, options=excluded.options, updated_at=excluded.updated_at`)

  const now = nowISO()
  const insertMany = db.transaction((items) => {
    for (const f of items) {
      upsert.run({
        id: f.id || uuidv4(),
        name: f.name,
        label: f.label || f.name,
        type: f.type || 'text',
        required: f.required ? 1 : 0,
        static: 1,
        options: f.options ? JSON.stringify(f.options) : null,
        placeholder: f.placeholder || null,
        created_at: now,
        updated_at: now,
      })
    }
  })

  try {
    insertMany(fieldsData)
  } catch (err) {
    console.error('[electron-db] uploadStaticFieldsToSupabase error', err)
  }
}
