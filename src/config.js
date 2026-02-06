const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const CONFIG_FILE = path.join(app.getPath('userData') || '.', 'config.json')

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
      const json = JSON.parse(raw)
      return json && typeof json === 'object' ? json : {}
    }
  } catch (err) {
    console.error('[config] read error', err)
  }
  return {}
}

function writeConfig(cfg) {
  try {
    const dir = path.dirname(CONFIG_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg || {}, null, 2), 'utf8')
    return true
  } catch (err) {
    console.error('[config] write error', err)
    return false
  }
}

function getSyncRoot() {
  const cfg = readConfig()
  const p = cfg.syncRoot
  if (p && typeof p === 'string' && p.trim()) return p
  // Default: try common Dropbox path; fallback to userData
  const home = app.getPath('home') || ''
  const dropboxDefault = path.join(home, 'Dropbox', 'IssueDB')
  return dropboxDefault
}

function setSyncRoot(p) {
  const cfg = readConfig()
  cfg.syncRoot = String(p || '')
  return writeConfig(cfg)
}

function getDataRoot() {
  // Where we store app.db and photos
  const root = getSyncRoot()
  try {
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
  } catch (err) {
    console.error('[config] ensure data root', err)
  }
  return root
}

module.exports = { getSyncRoot, setSyncRoot, getDataRoot }

