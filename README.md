<p align="center">
  <img src="docs/assets/hero.png" alt="WattSapDrive — WhatsApp as cloud storage" width="920">
</p>

<h1 align="center">WattSapDrive</h1>

<p align="center">
  <strong>WhatsApp як хмарне сховище</strong><br>
  Файли живуть у чаті / групі WhatsApp.<br>
  Керуєш ними через локальний веб-диск.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Baileys-WhatsApp-25D366?style=flat-square&logo=whatsapp&logoColor=white" alt="Baileys">
  <img src="https://img.shields.io/badge/UI-localhost%3A3000-0ea5e9?style=flat-square" alt="UI">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT">
</p>

---

## Навіщо це

WhatsApp уже вміє тримати медіа. WattSapDrive додає зверху **каталог папок**, веб-UI і API — щоб не шукати файл у стрічці повідомлень.

```text
  ┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
  │  Web UI /   │  upload │   WattSap    │  send   │  WhatsApp group │
  │  curl API   │ ──────► │   Drive bot  │ ──────► │  (your vault)   │
  └─────────────┘         └──────────────┘         └─────────────────┘
         ▲                        │
         │                   catalog
         └──────── download ◄─────┘
```

## Можливості

| | |
|---|---|
| **Веб-диск** | дерево папок, drag-and-drop, upload цілої теки |
| **Пошук** | за назвою або шляхом |
| **Організація** | mkdir, rename / move, delete з каталогу |
| **Захист** | Bearer-токен на `/api/*` |
| **QR логін** | `/qr` → Linked Devices у WhatsApp |

> Delete / rename змінюють **каталог** (`drive-config.json`). Повідомлення в WhatsApp лишаються.

## Швидкий старт

```bash
git clone https://github.com/xsilofon-dev/wattsapdrive.git
cd wattsapdrive
npm install
node src/bot.js
```

1. Відкрий [http://127.0.0.1:3000/qr](http://127.0.0.1:3000/qr) і відскануй QR у WhatsApp → **Linked devices**.
2. UI: [http://127.0.0.1:3000](http://127.0.0.1:3000)
3. Токен з’явиться в статусі / `app-config.json` (не коміть його).

Опційно: `./install.sh` поставить systemd user unit.

## API (коротко)

```bash
# статус (без токена)
curl http://127.0.0.1:3000/api/status

# каталог
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3000/api/drive

# upload
curl -X POST http://127.0.0.1:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-file-name: notes/hello.txt" \
  --data-binary @hello.txt

# download
curl -OJ -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3000/api/download/MESSAGE_ID
```

Також: `POST /api/mkdir`, `POST /api/rename`, `DELETE /api/files/:id`, `DELETE /api/folders`.

## Стек

| Шар | Технологія |
|-----|------------|
| Backend | Node.js · Express |
| WhatsApp | [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) |
| Frontend | один `web/index.html` |
| Каталог | `drive-config.json` |
| Налаштування | `app-config.json` (локально, у `.gitignore`) |

## Важливо знати

- Це **немагічний безлімітний Google Drive**. Ліміти WhatsApp (розмір медіа, сесія Linked Devices) лишаються.
- Не тримай одночасно WhatsApp Desktop і бота на одній сесії — буде конфлікт **440**.
- Не коміть `auth/`, `app-config.json`, токени, логи.

## Contributors

<p align="center">
  <a href="https://github.com/xsilofon-dev"><img src="https://github.com/xsilofon-dev.png?size=96" width="96" height="96" alt="xsilofon-dev" style="border-radius:50%"/></a>
  &nbsp;&nbsp;
  <a href="https://github.com/cursoragent"><img src="https://github.com/cursoragent.png?size=96" width="96" height="96" alt="Cursor Agent" style="border-radius:50%"/></a>
  &nbsp;&nbsp;
  <a href="https://github.com/deepseek-ai"><img src="https://github.com/deepseek-ai.png?size=96" width="96" height="96" alt="DeepSeek" style="border-radius:50%"/></a>
  &nbsp;&nbsp;
  <a href="https://github.com/Kilo-Org"><img src="https://github.com/Kilo-Org.png?size=96" width="96" height="96" alt="Kilo Code" style="border-radius:50%"/></a>
</p>

<p align="center">
  <a href="https://github.com/xsilofon-dev"><b>xsilofon-dev</b></a>
  ·
  <a href="https://github.com/cursoragent"><b>Cursor Agent</b></a>
  ·
  <a href="https://github.com/deepseek-ai"><b>DeepSeek</b></a>
  ·
  <a href="https://github.com/Kilo-Org"><b>Kilo Code</b></a>
</p>

Детальніше: [CONTRIBUTORS.md](CONTRIBUTORS.md)

## Ліцензія

MIT
