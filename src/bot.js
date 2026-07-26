const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  Browsers
} = require('@whiskeysockets/baileys')
const pino = require('pino')
const qrcodeTerminal = require('qrcode-terminal')
const QRCode = require('qrcode')
const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
const AUTH = path.join(ROOT, 'auth')
const DRIVE = path.join(ROOT, 'drive-config.json')
const APP_CFG = path.join(ROOT, 'app-config.json')
const CACHE_LEGACY = path.join(ROOT, 'files_cache.json')
const FOLDERS_LEGACY = path.join(ROOT, 'folders.json')
const GROUP = path.join(ROOT, 'group_id.txt')
const TMP = path.join(ROOT, 'tmp')
const LOCK = path.join(TMP, 'bot.pid')
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '127.0.0.1'
const WA_SEND_TIMEOUT_MS = Number(process.env.WA_SEND_TIMEOUT_MS || 180000)

fs.mkdirSync(AUTH, { recursive: true })
fs.mkdirSync(TMP, { recursive: true })

function acquireLock() {
  if (fs.existsSync(LOCK)) {
    const old = Number(String(fs.readFileSync(LOCK, 'utf8')).trim())
    if (old && old !== process.pid) {
      try {
        process.kill(old, 0)
        console.error(`WattSapDrive already running (pid ${old}). Kill it or remove ${LOCK}`)
        process.exit(1)
      } catch {}
    }
  }
  fs.writeFileSync(LOCK, String(process.pid))
  const clear = () => { try { if (String(fs.readFileSync(LOCK, 'utf8')).trim() === String(process.pid)) fs.unlinkSync(LOCK) } catch {} }
  process.on('exit', clear)
  process.on('SIGINT', () => { clear(); process.exit(0) })
  process.on('SIGTERM', () => { clear(); process.exit(0) })
}
acquireLock()

let uploadState = { active: false, name: '', size: 0, startedAt: null, phase: '' }

// last measured WhatsApp transfer speeds + cached profile for the status widget
let transferStats = {
  waUp: { bps: 0, size: 0, ms: 0, at: null, name: '' },
  waDown: { bps: 0, size: 0, ms: 0, at: null, name: '' }
}
let profileCache = {
  phone: null,
  jid: null,
  name: null,
  avatarBuf: null,
  avatarMime: null,
  avatarAt: 0,
  groupId: null,
  groupName: null,
  groupAt: 0,
  publicIp: null,
  ipAt: 0
}

function noteWaTransfer(dir, bytes, ms, name) {
  const n = Number(bytes) || 0
  const t = Number(ms) || 0
  if (n < 1 || t < 1) return
  const rec = {
    bps: n / (t / 1000),
    size: n,
    ms: t,
    at: new Date().toISOString(),
    name: name || ''
  }
  if (dir === 'up') transferStats.waUp = rec
  else transferStats.waDown = rec
}

async function refreshPublicIp(force = false) {
  if (!force && profileCache.ipAt && Date.now() - profileCache.ipAt < 5 * 60_000) return
  try {
    const r = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(4500)
    })
    if (!r.ok) return
    const j = await r.json()
    profileCache.publicIp = j.ip || null
    profileCache.ipAt = Date.now()
  } catch {}
}

async function refreshProfile(force = false) {
  if (!sock?.user?.id) return
  const bare = String(sock.user.id).split(':')[0]
  const jid = bare.includes('@') ? bare : `${bare}@s.whatsapp.net`
  profileCache.jid = jid
  profileCache.phone = '+' + jid.replace(/@.+$/, '')
  profileCache.name = sock.user.name || sock.user.verifiedName || null
  profileCache.groupId = gid || null

  if (force || !profileCache.avatarAt || Date.now() - profileCache.avatarAt > 10 * 60_000) {
    try {
      const url = await sock.profilePictureUrl(jid, 'image')
      if (url) {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (r.ok) {
          profileCache.avatarBuf = Buffer.from(await r.arrayBuffer())
          profileCache.avatarMime = r.headers.get('content-type') || 'image/jpeg'
          profileCache.avatarAt = Date.now()
        }
      }
    } catch {}
  }

  if (gid && (force || !profileCache.groupAt || Date.now() - profileCache.groupAt > 5 * 60_000 || profileCache.groupId !== gid)) {
    try {
      const meta = await sock.groupMetadata(gid)
      profileCache.groupName = meta?.subject || null
      profileCache.groupId = gid
      profileCache.groupAt = Date.now()
    } catch {
      profileCache.groupName = profileCache.groupName || null
    }
  }
}

function withTimeout(promise, ms, label) {
  let t
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms)
    })
  ])
}

function readAppConfig() {
  try { return JSON.parse(fs.readFileSync(APP_CFG, 'utf8')) } catch { return {} }
}

function ensureAppConfig() {
  if (fs.existsSync(APP_CFG)) return readAppConfig()
  const token = crypto.randomBytes(8).toString('hex')
  const cfg = {
    version: '0.3.0',
    auth: { token, enabled: true },
    drive: { defaultFolder: '', maxFileSize: '2gb', provider: 'whatsapp' },
    whatsapp: { group: '', phone: '' }
  }
  fs.writeFileSync(APP_CFG, JSON.stringify(cfg, null, 2))
  console.log('Created app-config.json · token', token)
  return cfg
}

function isCatalogShape(d) {
  return d && typeof d === 'object' && d.files && typeof d.files === 'object' && d.folders && typeof d.folders === 'object'
}

let sock = null
let gid = fs.existsSync(GROUP) ? fs.readFileSync(GROUP, 'utf8').trim() : null
let qrString = ''
let starting = false
let connectedAt = 0

// WhatsApp drops the socket often (code 440 when another device grabs the
// session), so wait for a fresh live socket instead of failing the upload.
async function waitForLiveSocket(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (sock?.user?.id && connectedAt && Date.now() - connectedAt > 1500) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return !!sock?.user?.id
}

function toNum(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'object' && 'low' in v) return Number(v.low) + Number(v.high || 0) * 4294967296
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function emptyDrive() {
  return {
    version: 1,
    defaultFolder: '',
    updatedAt: new Date().toISOString(),
    folders: {
      '': {
        path: '',
        name: '/',
        createdAt: new Date().toISOString(),
        fileCount: 0,
        totalSize: 0
      }
    },
    files: {}
  }
}

function sanitizePath(raw) {
  return String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(p => p.replace(/[^\w.\- \u0400-\u04FF]/g, '_').trim())
    .filter(p => p && p !== '.' && p !== '..')
    .join('/')
}

function readDrive() {
  try {
    const d = JSON.parse(fs.readFileSync(DRIVE, 'utf8'))
    // Deep accidentally wrote app settings into drive-config — ignore that shape
    if (!isCatalogShape(d)) return emptyDrive()
    if (!Object.prototype.hasOwnProperty.call(d.folders, '')) {
      d.folders[''] = {
        path: '', name: '/', createdAt: d.updatedAt || new Date().toISOString(),
        fileCount: 0, totalSize: 0
      }
    }
    if (d.defaultFolder == null) d.defaultFolder = ''
    return d
  } catch {
    return emptyDrive()
  }
}

function recomputeFolderStats(drive) {
  for (const key of Object.keys(drive.folders)) {
    drive.folders[key].fileCount = 0
    drive.folders[key].totalSize = 0
  }
  if (!drive.folders['']) {
    drive.folders[''] = {
      path: '', name: '/', createdAt: new Date().toISOString(),
      fileCount: 0, totalSize: 0
    }
  }
  for (const f of Object.values(drive.files)) {
    if (entryHidden(f) || isChunkPart(f.name)) continue
    const folder = f.folder || ''
    ensureFolder(drive, folder, f.uploadedAt)
    const node = drive.folders[folder]
    node.fileCount += 1
    node.totalSize += toNum(f.size)
  }
}

function writeDrive(drive) {
  recomputeFolderStats(drive)
  drive.updatedAt = new Date().toISOString()
  const tmp = DRIVE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(drive, null, 2))
  fs.renameSync(tmp, DRIVE)
}

function ensureFolder(drive, folderPath, createdAt) {
  const folder = sanitizePath(folderPath)
  const parts = folder ? folder.split('/') : []
  const chain = ['']
  let cur = ''
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p
    chain.push(cur)
  }
  for (const p of chain) {
    if (!drive.folders[p]) {
      drive.folders[p] = {
        path: p,
        name: p === '' ? '/' : p.split('/').pop(),
        createdAt: createdAt || new Date().toISOString(),
        fileCount: 0,
        totalSize: 0
      }
    }
  }
  return folder
}

function migrateLegacyIfNeeded() {
  // If drive-config is missing OR was overwritten by app-settings OR empty while legacy cache has data
  let need = !fs.existsSync(DRIVE)
  if (!need) {
    try {
      const cur = JSON.parse(fs.readFileSync(DRIVE, 'utf8'))
      if (!isCatalogShape(cur)) need = true
      else if (Object.keys(cur.files || {}).length === 0 && fs.existsSync(CACHE_LEGACY)) {
        const cache = JSON.parse(fs.readFileSync(CACHE_LEGACY, 'utf8') || '{}')
        if (Object.keys(cache).length) need = true
      }
    } catch { need = true }
  }
  if (!need) return
  // if current file looks like app settings, preserve it
  try {
    const cur = JSON.parse(fs.readFileSync(DRIVE, 'utf8'))
    if (cur && cur.auth && !isCatalogShape(cur) && !fs.existsSync(APP_CFG)) {
      fs.writeFileSync(APP_CFG, JSON.stringify(cur, null, 2))
      console.log('Moved settings → app-config.json')
    }
  } catch {}

  const drive = emptyDrive()
  try {
    if (fs.existsSync(FOLDERS_LEGACY)) {
      const list = JSON.parse(fs.readFileSync(FOLDERS_LEGACY, 'utf8'))
      if (Array.isArray(list)) for (const f of list) ensureFolder(drive, f)
    }
  } catch {}
  try {
    if (fs.existsSync(CACHE_LEGACY)) {
      const cache = JSON.parse(fs.readFileSync(CACHE_LEGACY, 'utf8'))
      for (const [id, e] of Object.entries(cache || {})) {
        const full = sanitizePath(e.name || id) || id
        const folder = e.folder != null
          ? sanitizePath(e.folder)
          : (String(full).includes('/') ? sanitizePath(String(full).split('/').slice(0, -1).join('/')) : '')
        const base = String(full).includes('/') ? String(full).split('/').pop() : String(full)
        const uploadedAt = toNum(e.ts)
          ? new Date(toNum(e.ts) * (toNum(e.ts) < 1e12 ? 1000 : 1)).toISOString()
          : new Date().toISOString()
        ensureFolder(drive, folder, uploadedAt)
        drive.files[id] = {
          id,
          path: folder ? `${folder}/${base}` : base,
          folder,
          name: base,
          size: toNum(e.size),
          mime: e.mime || 'application/octet-stream',
          uploadedAt,
          ts: toNum(e.ts),
          remoteJid: e.remoteJid || null,
          fromMe: !!e.fromMe,
          hidden: isSystemFile(base, folder),
          media: e.media || null
        }
      }
    }
  } catch {}
  writeDrive(drive)
  console.log('Restored catalog → drive-config.json')
}

migrateLegacyIfNeeded()
if (!fs.existsSync(DRIVE)) writeDrive(emptyDrive())

function targetJid() {
  if (gid) return gid
  if (!sock?.user?.id) return null
  return sock.user.id.split(':')[0] + '@s.whatsapp.net'
}

function mimeOf(name) {
  const ext = path.extname(name || '').toLowerCase()
  const map = {
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.txt': 'text/plain',
    '.md': 'text/plain', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.mp4': 'video/mp4', '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html',
    '.keep': 'text/plain'
  }
  return map[ext] || 'application/octet-stream'
}

// Markers WattSapDrive itself creates — never shown, never user data
function isInternalMarker(name, folder) {
  const base = String(name || '').split('/').pop()
  const folderPath = String(folder || '')
  if (!base) return true
  if (base === '.keep') return true
  if (folderPath === '_system' || folderPath.startsWith('_system/')) return true
  if (folderPath === '.ws' || folderPath.startsWith('.ws/')) return true
  return false
}

function isSystemFile(name, folder) {
  const base = String(name || '').split('/').pop()
  if (isInternalMarker(base, folder)) return true
  if (base.startsWith('.')) return true
  const sysNames = new Set([
    'drive-config.json', 'app-config.json', 'files_cache.json',
    'folders.json', 'group_id.txt', 'package.json', 'package-lock.json',
    'Thumbs.db', 'desktop.ini', 'Desktop.ini'
  ])
  return sysNames.has(base)
}

// Files the user uploaded on purpose stay visible even if they look "system"
function entryHidden(f) {
  if (!f) return true
  if (f.explicit) return isInternalMarker(f.name, f.folder)
  return !!f.hidden || isSystemFile(f.name, f.folder)
}

function isChunkPart(name) {
  const n = String(name || '')
  return /\.part\d{3}(of\d{3})?$/i.test(n)
}

function publicDrive() {
  const drive = readDrive()
  recomputeFolderStats(drive)
  const files = Object.values(drive.files)
    .filter(f => !entryHidden(f) && !isChunkPart(f.name))
    .map(f => ({
      id: f.id,
      path: f.path,
      folder: f.folder || '',
      name: f.name,
      size: f.size,
      mime: f.mime,
      uploadedAt: f.uploadedAt,
      ts: f.ts,
      hasMedia: !!(f.media && f.remoteJid) || !!(f.chunked && Array.isArray(f.parts) && f.parts.length),
      chunks: f.chunked ? (f.parts?.length || f.chunks || null) : null
    }))
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
  const folders = Object.values(drive.folders)
    .map(f => ({
      path: f.path,
      name: f.name,
      createdAt: f.createdAt,
      fileCount: f.fileCount,
      totalSize: f.totalSize
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return {
    version: drive.version,
    defaultFolder: drive.defaultFolder || '',
    updatedAt: drive.updatedAt,
    stats: {
      folders: folders.length,
      files: files.length,
      totalSize: files.reduce((s, f) => s + toNum(f.size), 0)
    },
    folders,
    files
  }
}

function indexMedia(m, opts = {}) {
  const d = m.message?.documentMessage || m.message?.imageMessage || m.message?.videoMessage
  if (!d || !m.key?.id) return
  const kind = m.message.documentMessage
    ? 'documentMessage'
    : m.message.imageMessage
      ? 'imageMessage'
      : 'videoMessage'
  const fullName = sanitizePath(d.fileName || d.caption || m.key.id) || m.key.id
  const folder = fullName.includes('/') ? fullName.split('/').slice(0, -1).join('/') : ''
  const base = fullName.includes('/') ? fullName.split('/').pop() : fullName
  const ts = toNum(m.messageTimestamp)
  const uploadedAt = ts ? new Date(ts * (ts < 1e12 ? 1000 : 1)).toISOString() : new Date().toISOString()
  const drive = readDrive()
  ensureFolder(drive, folder, uploadedAt)
  // WhatsApp echoes our own upload back through messages.upsert — keep the
  // explicit flag so a deliberately uploaded dotfile does not become hidden
  const explicit = !!opts.explicit || !!drive.files[m.key.id]?.explicit
  const chunkPart = isChunkPart(base)
  drive.files[m.key.id] = {
    id: m.key.id,
    path: fullName,
    folder,
    name: base,
    size: toNum(d.fileLength),
    mime: d.mimetype || 'application/octet-stream',
    uploadedAt,
    ts,
    remoteJid: m.key.remoteJid,
    fromMe: !!m.key.fromMe,
    explicit: explicit && !chunkPart,
    hidden: chunkPart || (explicit ? isInternalMarker(base, folder) : isSystemFile(base, folder)),
    chunkPart: chunkPart || undefined,
    media: { [kind]: d }
  }
  writeDrive(drive)
}

const app = express()
const appCfg = ensureAppConfig()
const AUTH_TOKEN = appCfg?.auth?.token || process.env.WS_TOKEN || ''
const AUTH_ENABLED = !!(appCfg?.auth?.enabled && AUTH_TOKEN)

app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next()
  if (!req.path.startsWith('/api/')) return next()
  if (req.path === '/api/status' || req.path === '/api/avatar' || req.path === '/api/speedtest') return next()
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || String(req.query.token || '')
  if (auth !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Auth required', hint: 'Send Authorization: Bearer <token>' })
  }
  next()
})
// don't let browsers keep a stale index.html without chunking
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
  }
  next()
})
app.use(express.static(path.join(ROOT, 'web'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    }
  }
}))

app.get('/qr', async (req, res) => {
  if (!qrString) {
    return res.send('<h2 style="font-family:system-ui">No QR (already linked or connecting…)</h2><meta http-equiv="refresh" content="3">')
  }
  try {
    const svg = await QRCode.toString(qrString, { type: 'svg', width: 240 })
    res.send(`<!doctype html><html><body style="margin:0;background:#0f0f14;display:flex;justify-content:center;align-items:center;min-height:100vh">${svg}</body></html>`)
  } catch (e) {
    res.status(500).send('QR error: ' + e.message)
  }
})

app.get('/api/status', async (req, res) => {
  const drive = readDrive()
  const started = uploadState.startedAt ? Date.parse(uploadState.startedAt) : 0
  // refresh profile/ip in background-ish (await briefly so first paint has data)
  if (sock?.user?.id) {
    await Promise.race([
      Promise.all([refreshProfile(false), refreshPublicIp(false)]),
      new Promise(r => setTimeout(r, 1200))
    ])
  } else {
    refreshPublicIp(false).catch(() => {})
  }
  res.json({
    connected: !!sock?.user?.id,
    c: !!sock?.user?.id,
    g: gid,
    user: sock?.user?.id || null,
    defaultFolder: drive.defaultFolder || '',
    updatedAt: drive.updatedAt,
    authRequired: AUTH_ENABLED,
    // localhost personal tool — UI needs token to call /api/drive
    token: AUTH_ENABLED ? AUTH_TOKEN : null,
    upload: uploadState.active ? {
      active: true,
      name: uploadState.name,
      size: uploadState.size,
      phase: uploadState.phase,
      startedAt: uploadState.startedAt,
      elapsedMs: started ? Date.now() - started : 0
    } : { active: false },
    me: {
      phone: profileCache.phone,
      jid: profileCache.jid,
      name: profileCache.name,
      avatar: profileCache.avatarBuf ? '/api/avatar' : null
    },
    group: {
      id: gid || profileCache.groupId || null,
      name: profileCache.groupName || null
    },
    net: {
      publicIp: profileCache.publicIp,
      waUp: transferStats.waUp,
      waDown: transferStats.waDown
    }
  })
})

app.get('/api/avatar', (req, res) => {
  if (!profileCache.avatarBuf) return res.status(404).json({ error: 'no avatar' })
  res.setHeader('Content-Type', profileCache.avatarMime || 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.send(profileCache.avatarBuf)
})

app.get('/api/speedtest', (req, res) => {
  const size = Math.min(Math.max(parseInt(req.query.size, 10) || 2_000_000, 64_000), 8_000_000)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Length', String(size))
  res.setHeader('Cache-Control', 'no-store')
  const chunk = Buffer.alloc(64 * 1024)
  let left = size
  const write = () => {
    while (left > 0) {
      const n = Math.min(chunk.length, left)
      const ok = res.write(n === chunk.length ? chunk : chunk.subarray(0, n))
      left -= n
      if (!ok) {
        res.once('drain', write)
        return
      }
    }
    res.end()
  }
  write()
})

app.post('/api/speedtest', express.raw({ type: '*/*', limit: '12mb' }), (req, res) => {
  const size = Buffer.isBuffer(req.body) ? req.body.length : 0
  res.json({ ok: true, size })
})

app.get('/api/drive', (req, res) => {
  res.json(publicDrive())
})

app.get('/api/files', (req, res) => {
  res.json(publicDrive().files)
})

app.get('/api/folders', (req, res) => {
  res.json(publicDrive().folders)
})

app.post('/api/mkdir', express.json({ limit: '32kb' }), async (req, res) => {
  const folder = sanitizePath(req.body?.path || req.body?.name || '')
  if (!folder) return res.status(400).json({ error: 'empty folder path' })
  const drive = readDrive()
  ensureFolder(drive, folder)
  writeDrive(drive)

  const markerName = folder + '/.keep'
  if (!sock?.user?.id) {
    return res.json({ ok: true, path: folder, uploaded: false, note: 'folder in drive-config; WA offline' })
  }
  try {
    const body = Buffer.from('wattsapdrive-folder\n', 'utf8')
    const sent = await sock.sendMessage(targetJid(), {
      document: body,
      fileName: markerName,
      mimetype: 'text/plain'
    })
    if (sent) indexMedia(sent)
    res.json({ ok: true, path: folder, uploaded: true, id: sent?.key?.id || null })
  } catch (e) {
    res.json({ ok: true, path: folder, uploaded: false, error: e.message })
  }
})

app.post('/api/msg', express.json({ limit: '64kb' }), async (req, res) => {
  if (!sock?.user?.id) return res.status(503).json({ error: 'WhatsApp not connected' })
  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: 'empty text' })
  const jid = targetJid()
  if (!jid) return res.status(503).json({ error: 'No target chat' })
  try {
    await sock.sendMessage(jid, { text })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/files/:id', (req, res) => {
  const drive = readDrive()
  const id = req.params.id
  if (!drive.files[id]) return res.status(404).json({ error: 'not found' })
  const removed = drive.files[id]
  delete drive.files[id]
  writeDrive(drive)
  res.json({ ok: true, id, path: removed.path })
})

app.post('/api/rename', express.json({ limit: '32kb' }), (req, res) => {
  const id = String(req.body?.id || '')
  let newPath = sanitizePath(req.body?.path || req.body?.to || '')
  if (!id || !newPath) return res.status(400).json({ error: 'id and path required' })
  const drive = readDrive()
  const entry = drive.files[id]
  if (!entry) return res.status(404).json({ error: 'not found' })
  const folder = newPath.includes('/') ? newPath.split('/').slice(0, -1).join('/') : ''
  const base = newPath.includes('/') ? newPath.split('/').pop() : newPath
  if (isInternalMarker(base, folder)) return res.status(400).json({ error: 'reserved internal name' })
  ensureFolder(drive, folder)
  entry.path = newPath
  entry.folder = folder
  entry.name = base
  entry.explicit = true
  entry.hidden = false
  drive.files[id] = entry
  writeDrive(drive)
  res.json({ ok: true, id, path: newPath, folder, name: base })
})

app.delete('/api/folders', express.json({ limit: '32kb' }), (req, res) => {
  const folder = sanitizePath(req.body?.path || '')
  if (!folder) return res.status(400).json({ error: 'cannot delete root' })
  const drive = readDrive()
  const blocked = Object.values(drive.files).some(f => {
    if (entryHidden(f)) return false
    const fp = f.folder || ''
    return fp === folder || fp.startsWith(folder + '/')
  })
  if (blocked) return res.status(400).json({ error: 'folder not empty' })
  for (const key of Object.keys(drive.folders)) {
    if (key === folder || key.startsWith(folder + '/')) delete drive.folders[key]
  }
  // remove .keep markers for this folder from catalog
  for (const [id, f] of Object.entries(drive.files)) {
    if ((f.folder || '') === folder && f.name === '.keep') delete drive.files[id]
  }
  writeDrive(drive)
  res.json({ ok: true, path: folder })
})

app.post('/api/folders/move', express.json({ limit: '32kb' }), (req, res) => {
  const from = sanitizePath(req.body?.from || '')
  const to = sanitizePath(req.body?.to || req.body?.path || '')
  if (!from) return res.status(400).json({ error: 'cannot move root' })
  if (!to) return res.status(400).json({ error: 'destination required' })
  if (from === to) return res.status(400).json({ error: 'same path' })
  if (to.startsWith(from + '/')) {
    return res.status(400).json({ error: 'cannot move a folder into itself' })
  }
  const drive = readDrive()
  if (!drive.folders[from]) return res.status(404).json({ error: 'folder not found' })

  ensureFolder(drive, to)

  // remap folder keys: from → to, from/x → to/x
  for (const key of Object.keys(drive.folders)) {
    if (key === from || key.startsWith(from + '/')) {
      const suffix = key.slice(from.length) // '' or '/rest'
      const newKey = to + suffix
      if (key !== newKey) {
        drive.folders[newKey] = { ...drive.folders[key], path: newKey, name: newKey.split('/').pop() }
        delete drive.folders[key]
      }
    }
  }

  // remap files under the moved folder
  let moved = 0
  for (const f of Object.values(drive.files)) {
    const fp = f.folder || ''
    if (fp === from || fp.startsWith(from + '/')) {
      const suffix = fp.slice(from.length)
      const newFolder = to + suffix
      f.folder = newFolder
      f.path = newFolder ? `${newFolder}/${f.name}` : f.name
      moved++
    }
  }

  writeDrive(drive)
  res.json({ ok: true, from, to, filesMoved: moved })
})

app.post('/api/upload', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  if (!sock?.user?.id) return res.status(503).json({ error: 'WhatsApp not connected' })
  if (uploadState.active) return res.status(409).json({ error: 'upload already in progress', upload: uploadState })
  const jid = targetJid()
  if (!jid) return res.status(503).json({ error: 'No target chat' })

  const drive = readDrive()
  const defaultFolder = sanitizePath(drive.defaultFolder || '')
  let name = sanitizePath(req.headers['x-file-name'] || 'file') || 'file'
  const folderHdr = req.headers['x-folder']
  if (folderHdr != null && folderHdr !== undefined) {
    const folder = sanitizePath(String(folderHdr))
    const base = name.includes('/') ? name.split('/').pop() : name
    name = folder ? `${folder}/${base}` : base
  } else if (!name.includes('/') && defaultFolder) {
    name = `${defaultFolder}/${name}`
  }

  const baseName = name.includes('/') ? name.split('/').pop() : name
  const folderPart = name.includes('/') ? name.split('/').slice(0, -1).join('/') : ''
  if (isInternalMarker(baseName, folderPart)) {
    return res.status(400).json({ error: 'reserved internal name', name })
  }

  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || [])
  if (!buf.length) return res.status(400).json({ error: 'empty body' })

  const t0 = Date.now()
  uploadState = {
    active: true,
    name,
    size: buf.length,
    startedAt: new Date().toISOString(),
    phase: 'whatsapp'
  }
  console.log(`upload start ${name} (${buf.length} B)`)
  try {
    let sent = null
    let lastErr = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!sock?.user?.id) {
        uploadState.phase = 'reconnect'
        await waitForLiveSocket()
      }
      if (!sock?.user?.id) throw new Error('WhatsApp not connected')
      try {
        uploadState.phase = attempt > 1 ? `whatsapp retry ${attempt}` : 'whatsapp'
        sent = await withTimeout(
          sock.sendMessage(jid, {
            document: buf,
            fileName: name,
            mimetype: mimeOf(name)
          }),
          WA_SEND_TIMEOUT_MS,
          'whatsapp send'
        )
        break
      } catch (err) {
        lastErr = err
        const retryable = /connection closed|connection lost|closed|timed out/i.test(err.message)
        if (!retryable || attempt === 3) throw err
        console.log(`upload retry ${attempt} ${name}: ${err.message}`)
        uploadState.phase = 'reconnect'
        await waitForLiveSocket()
      }
    }
    if (!sent) throw lastErr || new Error('send failed')
    indexMedia(sent, { explicit: true })
    const ms = Date.now() - t0
    noteWaTransfer('up', buf.length, ms, name)
    console.log(`upload ok ${name} in ${ms}ms`)
    res.json({
      ok: true,
      name,
      folder: folderPart,
      id: sent?.key?.id || null,
      size: buf.length,
      ms,
      bps: buf.length / (ms / 1000)
    })
  } catch (e) {
    console.error(`upload fail ${name}: ${e.message}`)
    const status = /timeout/i.test(e.message) ? 504 : (/not connected|closed/i.test(e.message) ? 503 : 500)
    res.status(status).json({ error: e.message, name, size: buf.length, ms: Date.now() - t0 })
  } finally {
    uploadState = { active: false, name: '', size: 0, startedAt: null, phase: '' }
  }
})

function extractSentMedia(sent) {
  if (!sent?.key?.id) return null
  const d = sent.message?.documentMessage || sent.message?.imageMessage || sent.message?.videoMessage
  if (!d) return null
  const kind = sent.message.documentMessage
    ? 'documentMessage'
    : sent.message.imageMessage
      ? 'imageMessage'
      : 'videoMessage'
  return {
    id: sent.key.id,
    remoteJid: sent.key.remoteJid,
    fromMe: !!sent.key.fromMe,
    size: toNum(d.fileLength),
    mime: d.mimetype || 'application/octet-stream',
    media: { [kind]: d }
  }
}

async function sendWaDocument(jid, buf, fileName, mimetype) {
  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!sock?.user?.id) {
      uploadState.phase = 'reconnect'
      await waitForLiveSocket()
    }
    if (!sock?.user?.id) throw new Error('WhatsApp not connected')
    try {
      uploadState.phase = attempt > 1 ? `whatsapp retry ${attempt}` : 'whatsapp'
      return await withTimeout(
        sock.sendMessage(jid, {
          document: buf,
          fileName,
          mimetype: mimetype || mimeOf(fileName)
        }),
        WA_SEND_TIMEOUT_MS,
        'whatsapp send'
      )
    } catch (err) {
      lastErr = err
      const retryable = /connection closed|connection lost|closed|timed out/i.test(err.message)
      if (!retryable || attempt === 3) throw err
      console.log(`upload retry ${attempt} ${fileName}: ${err.message}`)
      uploadState.phase = 'reconnect'
      await waitForLiveSocket()
    }
  }
  throw lastErr || new Error('send failed')
}

// Chunked upload: one part per request. Catalog shows ONE merged file when all parts arrive.
app.post('/api/upload-chunk', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  if (!sock?.user?.id) return res.status(503).json({ error: 'WhatsApp not connected' })
  if (uploadState.active) return res.status(409).json({ error: 'upload already in progress', upload: uploadState })
  const jid = targetJid()
  if (!jid) return res.status(503).json({ error: 'No target chat' })

  const uid = String(req.headers['x-chunk-uid'] || '').trim()
  const idx = parseInt(req.headers['x-chunk-index'], 10)
  const total = parseInt(req.headers['x-chunk-total'], 10)
  const totalSize = parseInt(req.headers['x-file-size'], 10) || 0
  let name = sanitizePath(req.headers['x-file-name'] || 'file') || 'file'
  if (!uid || !Number.isFinite(idx) || idx < 0 || !Number.isFinite(total) || total < 2) {
    return res.status(400).json({ error: 'x-chunk-uid, x-chunk-index, x-chunk-total required' })
  }
  if (idx >= total) return res.status(400).json({ error: 'chunk index out of range' })

  const folderPart = name.includes('/') ? name.split('/').slice(0, -1).join('/') : ''
  const baseName = name.includes('/') ? name.split('/').pop() : name
  if (isInternalMarker(baseName, folderPart)) {
    return res.status(400).json({ error: 'reserved internal name', name })
  }

  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || [])
  if (!buf.length) return res.status(400).json({ error: 'empty body' })

  const partLabel = String(idx + 1).padStart(3, '0')
  const totalLabel = String(total).padStart(3, '0')
  const partFileName = `${name}.part${partLabel}of${totalLabel}`

  const t0 = Date.now()
  uploadState = {
    active: true,
    name: partFileName,
    size: buf.length,
    startedAt: new Date().toISOString(),
    phase: 'whatsapp'
  }
  console.log(`chunk ${idx + 1}/${total} start ${partFileName} (${buf.length} B)`)

  try {
    const sent = await sendWaDocument(jid, buf, partFileName, 'application/octet-stream')
    const meta = extractSentMedia(sent)
    if (!meta) throw new Error('WhatsApp returned no media metadata')

    // index part as hidden catalog row (also survives WA echo)
    indexMedia(sent, { explicit: true })
    const drive = readDrive()
    if (drive.files[meta.id]) {
      drive.files[meta.id].hidden = true
      drive.files[meta.id].chunkPart = true
      drive.files[meta.id].explicit = false
    }

    if (!drive.chunkSessions) drive.chunkSessions = {}
    const sess = drive.chunkSessions[uid] || {
      uid,
      path: name,
      folder: folderPart,
      name: baseName,
      total,
      totalSize,
      parts: {},
      createdAt: new Date().toISOString()
    }
    sess.parts[String(idx)] = {
      index: idx,
      id: meta.id,
      size: buf.length,
      remoteJid: meta.remoteJid,
      fromMe: meta.fromMe,
      media: meta.media
    }
    sess.updatedAt = new Date().toISOString()
    if (totalSize) sess.totalSize = totalSize
    drive.chunkSessions[uid] = sess

    const got = Object.keys(sess.parts).length
    let merged = null
    if (got >= total) {
      const parts = []
      for (let i = 0; i < total; i++) {
        const p = sess.parts[String(i)]
        if (!p) throw new Error(`missing chunk ${i + 1}/${total}`)
        parts.push(p)
      }
      const sumSize = parts.reduce((s, p) => s + toNum(p.size), 0)
      const mergedId = 'chunked_' + uid
      ensureFolder(drive, folderPart)
      drive.files[mergedId] = {
        id: mergedId,
        path: name,
        folder: folderPart,
        name: baseName,
        size: totalSize || sumSize,
        mime: mimeOf(name),
        uploadedAt: new Date().toISOString(),
        explicit: true,
        hidden: false,
        chunked: true,
        chunkUid: uid,
        parts: parts.map(p => ({
          index: p.index,
          id: p.id,
          size: p.size,
          remoteJid: p.remoteJid,
          fromMe: p.fromMe,
          media: p.media
        }))
      }
      delete drive.chunkSessions[uid]
      merged = { id: mergedId, path: name, size: drive.files[mergedId].size, parts: total }
      console.log(`chunk merge ok ${name} → ${mergedId} (${total} parts, ${drive.files[mergedId].size} B)`)
    }

    writeDrive(drive)
    const ms = Date.now() - t0
    noteWaTransfer('up', buf.length, ms, partFileName)
    res.json({
      ok: true,
      uid,
      chunk: idx + 1,
      total,
      got,
      done: !!merged,
      id: merged?.id || meta.id,
      name,
      size: buf.length,
      ms,
      bps: buf.length / (ms / 1000),
      merged
    })
  } catch (e) {
    console.error(`chunk fail ${partFileName}: ${e.message}`)
    const status = /timeout/i.test(e.message) ? 504 : (/not connected|closed/i.test(e.message) ? 503 : 500)
    res.status(status).json({ error: e.message, name: partFileName, chunk: idx + 1, total })
  } finally {
    uploadState = { active: false, name: '', size: 0, startedAt: null, phase: '' }
  }
})

app.get('/api/download/:id', async (req, res) => {
  if (!sock?.user?.id) return res.status(503).json({ error: 'WhatsApp not connected' })
  const drive = readDrive()
  const entry = drive.files[req.params.id]
  if (!entry) return res.status(404).json({ error: 'not found' })
  const t0 = Date.now()

  // reassembled multi-part file
  if (entry.chunked && Array.isArray(entry.parts) && entry.parts.length) {
    try {
      const parts = [...entry.parts].sort((a, b) => a.index - b.index)
      res.setHeader('Content-Type', entry.mime || 'application/octet-stream')
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(entry.name)}"`)
      if (entry.size) res.setHeader('Content-Length', String(entry.size))
      let downloaded = 0
      for (const part of parts) {
        if (!part.media || !part.remoteJid) throw new Error(`chunk ${part.index} missing media`)
        const msg = {
          key: { id: part.id, remoteJid: part.remoteJid, fromMe: part.fromMe },
          message: part.media
        }
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        )
        downloaded += buffer.length
        res.write(buffer)
      }
      noteWaTransfer('down', downloaded, Date.now() - t0, entry.name)
      return res.end()
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (!entry?.media || !entry.remoteJid) {
    return res.status(404).json({ error: 'File missing in drive-config or no media metadata' })
  }
  try {
    const msg = {
      key: { id: entry.id, remoteJid: entry.remoteJid, fromMe: entry.fromMe },
      message: entry.media
    }
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
    )
    noteWaTransfer('down', buffer.length, Date.now() - t0, entry.name)
    res.setHeader('Content-Type', entry.mime || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(entry.name)}"`)
    res.send(buffer)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, HOST, () => {
  console.log(`WattSapDrive UI http://${HOST}:${PORT}`)
  console.log(`Config: ${DRIVE}`)
})

async function start() {
  if (starting) return
  starting = true
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH)
    sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
      if (qr) {
        qrString = qr
        console.log('\nScan QR: terminal below OR http://127.0.0.1:' + PORT + '/qr\n')
        qrcodeTerminal.generate(qr, { small: true })
      }
      if (connection === 'open') {
        qrString = ''
        connectedAt = Date.now()
        console.log('WhatsApp connected:', sock.user?.id)
        refreshProfile(true).catch(() => {})
        refreshPublicIp(true).catch(() => {})
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        console.log('WhatsApp closed, code:', code)
        sock = null
        starting = false
        if (code !== DisconnectReason.loggedOut) setTimeout(start, 4000)
        else console.log('Logged out. Delete auth/ and scan QR again.')
        return
      }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const m of messages) {
        if (m.key.remoteJid?.endsWith('@g.us') && !gid) {
          gid = m.key.remoteJid
          fs.writeFileSync(GROUP, gid)
          console.log('Group saved:', gid)
        }
        indexMedia(m)
      }
    })
  } catch (e) {
    console.error('start failed:', e)
    starting = false
    setTimeout(start, 5000)
    return
  }
  starting = false
}

start().catch(console.error)
