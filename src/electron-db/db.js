const path = require("path");
const fs = require("fs");
const { app } = require("electron");

let Database;
try {
  Database = require("better-sqlite3");
} catch (err) {
  throw new Error(
    "Please install better-sqlite3: `npm install better-sqlite3`",
  );
}
const dbFile = path.join(__dirname, "../../app.db");

//const dbFile = path.join(app.getPath("userData") || ".", "app.db");
const dir = path.dirname(dbFile);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbFile);

// Initialize tables
db.pragma("journal_mode = WAL");

db.exec(
  `CREATE TABLE IF NOT EXISTS fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        label TEXT,
        type TEXT NOT NULL DEFAULT 'text',
        required BOOLEAN DEFAULT FALSE,
        static BOOLEAN DEFAULT FALSE,
        options TEXT,
        placeholder TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
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


    `,
);

try {
  db.exec(`
        BEGIN TRANSACTION;

INSERT INTO fields (name, label, type, required, static, options, placeholder) VALUES
('project_name', 'Project Name', 'text', 0, 1, NULL, NULL),
('business_name', 'Business Name', 'text', 0, 1, NULL, NULL),
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
('ppt', 'PPT', 'text', 0, 1, NULL, NULL),
('exemplar', 'Exemplar', 'text', 0, 1, NULL, NULL),
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
