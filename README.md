# 🟢 WattSapDrive

**WhatsApp як безкоштовне необмежене хмарне сховище**

Завантажуйте, зберігайте та отримуйте файли через звичайний WhatsApp чат. Без лімітів, безкоштовно.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-green" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">
  <img src="https://img.shields.io/badge/platform-Node.js-brightgreen" alt="platform">
  <img src="https://img.shields.io/badge/storage-WhatsApp-25D366" alt="storage">
</p>

---

## ✨ Можливості

- 📤 Завантаження файлів до **2GB** через веб-інтерфейс
- 📁 Дерево папок (створення, drag-and-drop)
- 🔒 Auth-токен для захисту API
- 📱 WhatsApp-група для спілкування та сповіщень
- 🔄 Автоматичне перепідключення при втраті зв'язку
- 🖥️ Працює як systemd сервіс (автозапуск)

## 🚀 Швидкий старт

```bash
git clone https://github.com/xsilofon-dev/wattsapdrive.git
cd wattsapdrive
chmod +x install.sh
./install.sh
```

Відкрийте `http://localhost:3000/qr` та відскануйте QR-код у WhatsApp.

## 📡 API

**Статус:**
```bash
curl http://localhost:3000/api/status
```

**Завантажити файл:**
```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-file-name: myfile.txt" \
  --data-binary @myfile.txt
```

**Список файлів:**
```bash
curl http://localhost:3000/api/files
```

## 🛠️ Стек

| Компонент | Технологія |
|-----------|-----------|
| Backend | Node.js + Express |
| WhatsApp API | @whiskeysockets/baileys |
| Frontend | HTML5 + CSS + JavaScript |
| Auth | Bearer Token |
| Сервіс | Systemd (Linux) |

## 📁 Конфігурація

`drive-config.json`:
```json
{
  "auth": { "token": "YOUR_TOKEN", "enabled": true },
  "drive": { "maxFileSize": "2gb", "provider": "whatsapp" },
  "whatsapp": { "group": "GROUP_ID", "phone": "PHONE" }
}
```

## 🧠 Агенти

Проект створено та підтримується AI-агентами (Kilo, Cursor) з людським наглядом (xsilofon-dev).

## 📄 Ліцензія

MIT — використовуйте, змінюйте, розповсюджуйте.
