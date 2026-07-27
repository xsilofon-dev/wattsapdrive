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
  <img src="https://img.shields.io/badge/version-0.3.1-25D366?style=flat-square" alt="0.3.1">
  <img src="https://img.shields.io/badge/Termux-Android-000000?style=flat-square&logo=android&logoColor=white" alt="Termux">
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
| **Мульти-пристрій** | ПК + Termux: спільна група + експорт/імпорт каталогу |
| **Захист** | Bearer-токен на `/api/*` (автогенерація при install) |
| **Привʼязка** | `/pair` — код з телефону (Termux) · `/qr` — з другого екрана |

> Delete / rename змінюють **каталог** (`drive-config.json`). Повідомлення в WhatsApp лишаються.

## Termux (Android)

Повна інструкція: **[TERMUX.md](./TERMUX.md)**

```bash
pkg update -y && pkg install -y git nodejs
git clone https://github.com/xsilofon-dev/wattsapdrive.git
cd wattsapdrive
bash install-termux.sh
# або зі своєю назвою:
# VAULT_NAME="Мій Диск" bash install-termux.sh
```

Далі: **http://127.0.0.1:3000/pair** → код → WhatsApp → *Привʼязати за номером*.  
**Не тисни QR** на тому ж телефоні.

Оновлення:

```bash
cd ~/wattsapdrive && git pull && bash install-termux.sh
```


## Android APK (телефон)

1. Завантаж **[WattSapDrive-0.3.2.apk](https://github.com/xsilofon-dev/wattsapdrive/releases/latest)** з Releases.
2. Дозволь установку з невідомих джерел для браузера/файлового менеджера.
3. Встанови APK → відкрий додаток → вкажи адресу бота (напр. `http://127.0.0.1:3000` через `adb reverse`, або LAN IP ПК).
4. На ПК має працювати WattSapDrive (`node src/bot.js` / Termux / systemd).

Галерея, завантаження папок і кнопка **↓ Ще** працюють у WebView-обгортці.

## Встановлення на ПК / Linux

Потрібен **Node.js 18+**.

```bash
git clone https://github.com/xsilofon-dev/wattsapdrive.git
cd wattsapdrive
chmod +x install.sh
./install.sh
# VAULT_NAME="Мій Диск" ./install.sh
```

Інсталятор:

1. `npm install`
2. назва сховища (`VAULT_NAME` або питання)
3. `app-config.json` з токеном + порожній каталог
4. systemd user service (якщо є)
5. linger (опційно)

Потім:

1. **/pair** (телефон) або **/qr** (другий екран)
2. у UI обери/створи **групу-сховище**
3. UI: **http://127.0.0.1:3000**

Без systemd: `npm install && npm start`

### Керування сервісом (ПК)

```bash
systemctl --user status wattsapdrive
systemctl --user restart wattsapdrive
journalctl --user -u wattsapdrive -f
```

## Той самий акаунт, різні пристрої

1. На кожному пристрої — **окремий** `/pair` (не копіюй `auth/`)
2. Обери **ту саму групу**
3. Дерево папок: на одному **↧ Каталог** → на іншому **↥ Імпорт**

## API (коротко)

```bash
curl http://127.0.0.1:3000/api/status

curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3000/api/drive

curl -X POST http://127.0.0.1:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-file-name: notes/hello.txt" \
  --data-binary @hello.txt

curl -OJ -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3000/api/download/MESSAGE_ID
```

Також: `POST /api/mkdir`, `POST /api/rename`, `POST /api/folders/move`,  
`DELETE /api/files/:id`, `DELETE /api/folders`, `POST /api/upload-chunk`,  
`GET|POST /api/speedtest`, `GET /api/groups`, `POST /api/groups/select|create`,  
`GET /api/catalog/export`, `POST /api/catalog/import`.

## Стек

| Шар | Технологія |
|-----|------------|
| Backend | Node.js · Express |
| WhatsApp | [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) |
| Frontend | один `web/index.html` |
| Каталог | `drive-config.json` |
| Налаштування | `app-config.json` (локально, у `.gitignore`) |

## Важливо знати

- Це **немагічний безлімітний Google Drive**. Ліміти WhatsApp лишаються.
- Не тримай WhatsApp Desktop + бот на одній скопійованій `auth/` — конфлікт **440**.
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
