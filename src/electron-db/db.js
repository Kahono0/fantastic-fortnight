const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const config = require('../config')

let Database
try {
  Database = require('better-sqlite3')
} catch (err) {
  throw new Error('Please install better-sqlite3: `npm install better-sqlite3`')
}

const dataRoot = config.getDataRoot()
const dbFile = path.join(dataRoot, 'app.db')
const dir = path.dirname(dbFile)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

const db = new Database(dbFile)

// Initialize tables
// Safer for cloud-sync folders: avoid WAL/SHM multi-file state
db.pragma('journal_mode = DELETE')
db.pragma('synchronous = FULL')

db.exec(`
CREATE TABLE IF NOT EXISTS fields (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  label TEXT,
  type TEXT,
  required INTEGER DEFAULT 0,
  static INTEGER DEFAULT 0,
  options TEXT,
  placeholder TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  project_id INTEGER,
  data TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

-- Index table to support dynamic field filtering. Stores values in typed columns for efficient queries.
CREATE TABLE IF NOT EXISTS issue_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_date TEXT,
  UNIQUE(issue_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_issue_index_field_text ON issue_index(field_name, value_text);
CREATE INDEX IF NOT EXISTS idx_issue_index_field_number ON issue_index(field_name, value_number);
CREATE INDEX IF NOT EXISTS idx_issue_index_issue ON issue_index(issue_id);
CREATE INDEX IF NOT EXISTS idx_issues_record_id ON issues(record_id);
CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);

-- Projects table for electron-side project management
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

-- Defects table (linked to projects)
CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  number TEXT NOT NULL,
  description TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_defects_project_id ON defects(project_id);
CREATE INDEX IF NOT EXISTS idx_defects_number ON defects(number);

-- Records table (field notes linked to projects)
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  comments TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_records_project_id ON records(project_id);
CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at);
`)

// Lightweight migration: ensure project_id column exists on issues table
try {
  const cols = db.prepare('PRAGMA table_info(issues)').all()
  const hasProjectId = Array.isArray(cols) && cols.some((c) => c.name === 'project_id')
  if (!hasProjectId) {
    db.exec('ALTER TABLE issues ADD COLUMN project_id INTEGER')
    db.exec('CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id)')
  }
} catch (err) {
  // Ignore migration errors; table may already be up to date
}


try {
  db.exec(`
        BEGIN TRANSACTION;

INSERT INTO fields (name, label, type, required, static, options, placeholder) VALUES
('inspection_type', 'Inspection Type', 'text', 0, 1, NULL, NULL),
('inspection_date', 'Inspection Date', 'date', 0, 1, NULL, NULL),
('inspector', 'Inspector', 'text', 0, 1, NULL, NULL),
('address', 'Address', 'text', 0, 1, NULL, NULL),
('unit', 'Unit', 'text', 0, 1, NULL, NULL),
('building_visual_unit', 'Building Visual Unit', 'text', 0, 1, NULL, NULL),
('street', 'Street', 'text', 0, 1, NULL, NULL),
('building', 'Building', 'text', 0, 1, NULL, NULL),
('phase', 'Phase', 'text', 0, 1, NULL, NULL),
('plan_type', 'Plan Type', 'text', 0, 1, NULL, NULL),
('design_type', 'Design Type', 'text', 0, 1, NULL, NULL),
('ppt', 'PPT', 'boolean', 0, 1, NULL, NULL),
('exemplar', 'exemplar', 'boolean', 0, 1, NULL, NULL),
('issue', 'Issue', 'textarea', 0, 1, NULL, NULL),
('cladding', 'Cladding', 'text', 0, 1, NULL, NULL),
('component', 'Component', 'text', 0, 1, NULL, NULL),
('observation', 'Observation', 'textarea', 0, 1, NULL, NULL),
('room', 'Room', 'text', 0, 1, NULL, NULL),
('elevation', 'Elevation', 'text', 0, 1, NULL, NULL),
('location', 'Location', 'text', 0, 1, NULL, NULL),
('extent', 'Extent', 'text', 0, 1, NULL, NULL),
('lf', 'LF', 'number', 0, 1, NULL, NULL),
('sf', 'SF', 'number', 0, 1, NULL, NULL),
('count_total', 'Count (Total)', 'number', 0, 1, NULL, NULL),
('penetration_type', 'Penetration Type', 'text', 0, 1, NULL, NULL),
('window_type', 'Window Type', 'text', 0, 1, NULL, NULL),
('door_type', 'Door Type', 'text', 0, 1, NULL, NULL),
('photo_path', 'Photo Path', 'path', 0, 1, NULL, NULL);

COMMIT;
    `);
} catch (err) {
  db.exec("ROLLBACK;");
}

module.exports = db;
