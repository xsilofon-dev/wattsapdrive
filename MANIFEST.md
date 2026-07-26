# WattSapDrive — Manifest v0.1
**WhatsApp як безкоштовне хмарне сховище**

## Що це
WattSapDrive використовує WhatsApp API (Baileys) як бекенд для зберігання файлів.
Завантажуй, зберігай, отримуй — через звичайний WhatsApp чат.

## Як працює
1. Node.js бот підключається до WhatsApp через QR-код
2. Веб-інтерфейс на Express (порт 3000)
3. Файли зберігаються як повідомлення WhatsApp
4. Метадані — в локальному JSON-кеші

## Стек
- Node.js + Express
- @whiskeysockets/baileys (WhatsApp Web API)
- HTML/CSS/JS (веб-інтерфейс)

## Ліцензія
MIT

## Статус
Alpha v0.1 — базове завантаження працює. Груповий чат з AI-агентами в розробці.

## Автор
xsilofon-dev
