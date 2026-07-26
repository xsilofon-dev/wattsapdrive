const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')
const express = require('express')
const fs = require('fs')
const path = require('path')

const AUTH = path.join(__dirname, '..', 'auth')
const CACHE = path.join(__dirname, '..', 'files_cache.json')
if (!fs.existsSync(CACHE)) fs.writeFileSync(CACHE, '{}')

let sock = null
const app = express()
app.use(express.static(path.join(__dirname, '..', 'web')))

app.get('/api/files', (req, res) => {
  try { res.json(Object.values(JSON.parse(fs.readFileSync(CACHE,'utf8'))).reverse()) }
  catch { res.json([]) }
})

app.get('/api/status', (req, res) => {
  res.json({ connected: sock?.user?.id ? true : false })
})

app.post('/api/upload', express.raw({ type: '*/*', limit: '2gb' }), async (req, res) => {
  if (!sock) return res.status(503).json({ error: 'WhatsApp not connected' })
  try {
    const name = req.headers['x-file-name'] || 'file'
    const tmp = '/tmp/ws_' + Date.now()
    fs.writeFileSync(tmp, req.body)
    await sock.sendMessage(sock.user.id.split(':')[0] + '@s.whatsapp.net', {
      document: fs.readFileSync(tmp), fileName: name, mimetype: 'application/octet-stream'
    })
    fs.unlinkSync(tmp)
    res.json({ ok: true, name })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.listen(3000, () => console.log('http://localhost:3000'))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH)
  sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: true })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) console.log('\nQR:\n' + qr + '\n')
    if (connection === 'open') console.log('WhatsApp OK')
    if (connection === 'close') setTimeout(start, 5000)
  })
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.key.fromMe) continue
      const doc = msg.message?.documentMessage || msg.message?.imageMessage || msg.message?.videoMessage
      if (!doc) continue
      const cache = JSON.parse(fs.readFileSync(CACHE,'utf8'))
      cache[msg.key.id] = {
        id: msg.key.id, name: doc.fileName || doc.caption || msg.key.id,
        size: doc.fileLength, mime: doc.mimetype, ts: msg.messageTimestamp
      }
      fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2))
    }
  })
}
start().catch(console.error)
