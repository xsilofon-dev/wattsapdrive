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
  <img src="https://img.shields.io/badge/version-0.3.4-25D366?style=flat-square" alt="0.3.0">
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
| **Веб-диск (Yazi)** | 3 панелі: батько / поточна / прев’ю |
| **Заливка** | файли, цілі папки, drag-and-drop, Stop, retry |
| **Чанки** | файли &gt;95 MB ріжуться автоматично (~100 MB ліміт WA) |
| **Швидкості** | інтернет + WhatsApp ↑/↓, LIVE під час transfer |
| **Профіль** | аватар, номер, група, публічний IP |
| **Організація** | mkdir, rename/move файлів і папок, delete з каталогу |
| **Поділитись файлом** | відправити лише вибраний файл другу у WhatsApp або створити тимчасове LAN/VPN-посилання |
| **Захист** | Bearer-токен на `/api/*` (автогенерація при install) |
| **QR логін** | `/qr` → Linked Devices у WhatsApp |

> Delete / rename змінюють **каталог** (`drive-config.json`). Повідомлення в WhatsApp лишаються.

### Поділитись файлом — не диском

Вибери файл у веб-диску та натисни **↗ Поділитись**:

- **У WhatsApp другу** — введи номер із кодом країни; друг отримає звичайний документ у приватному чаті й не матиме доступу до інших файлів.
- **Тимчасове посилання** — обери термін дії 1, 6 або 24 години та скопіюй URL. Воно працює в мережі, з якої доступний WattSapDrive (LAN/VPN; через інтернет потрібен доступ до порту).

Великі чанкові файли при надсиланні у WhatsApp передаються послідовними частинами.


## Android APK (телефон)

1. Завантаж **[WattSapDrive-0.3.4.apk](https://github.com/xsilofon-dev/wattsapdrive/releases/latest)** з Releases.
2. Дозволь установку з невідомих джерел.
3. Встанови APK → відкрий → вкажи адресу бота (`http://127.0.0.1:3000` або LAN IP).
4. На ПК/Termux має крутитись WattSapDrive.

## Встановлення на новій машині

Потрібен **Node.js 18+**.

```bash
git clone https://github.com/xsilofon-dev/wattsapdrive.git
cd wattsapdrive
chmod +x install.sh
./install.sh
```

Інсталятор зробить:

1. `npm install`
2. згенерує `app-config.json` з випадковим токеном
3. створить порожній `drive-config.json`
4. поставить **systemd user** сервіс `wattsapdrive` і запустить його
5. увімкне linger (щоб сервіс жив після logout), якщо можливо

Потім:

1. Відкрий **http://127.0.0.1:3000/qr** → WhatsApp → **Linked devices** → скануй QR  
2. UI: **http://127.0.0.1:3000** (Ctrl+Shift+R якщо бачиш старий UI)  
3. Токен — у виводі інсталятора або в `app-config.json` (не коміть)

Без systemd:

```bash
npm install
npm start
```

### Керування сервісом

```bash
systemctl --user status wattsapdrive
systemctl --user restart wattsapdrive
journalctl --user -u wattsapdrive -f
```

## API (коротко)

```bash
# статус (без токена) — профіль, IP, швидкості
curl http://127.0.0.1:3000/api/status

# каталог
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3000/api/drive

# upload (файли >95MB — через UI чанкуються самі)
curl -X POST http://127.0.0.1:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-file-name: notes/hello.txt" \
  --data-binary @hello.txt

# download
curl -OJ -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3000/api/download/MESSAGE_ID
```

Також: `POST /api/mkdir`, `POST /api/rename`, `POST /api/folders/move`,  
`DELETE /api/files/:id`, `DELETE /api/folders`, `POST /api/upload-chunk`,  
`GET|POST /api/speedtest`, `POST /api/share`, `POST /api/share/link`,  
`GET /s/:token` (тимчасове публічне завантаження одного файла).

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
- Не коміть `auth/`, `app-config.json`, токени, логи, `drive-config.json`.

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
