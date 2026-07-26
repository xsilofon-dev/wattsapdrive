#!/data/data/com.termux/files/usr/bin/bash
# WattSapDrive — Termux installer (Android)
# Usage:
#   pkg install git nodejs
#   git clone https://github.com/xsilofon-dev/wattsapdrive.git
#   cd wattsapdrive && bash install-termux.sh
#   VAULT_NAME="Мій Диск" bash install-termux.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VERSION="0.3.1"
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
LOG="$ROOT/logs/bot.out"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

echo ""
echo "☁  WattSapDrive Termux Installer v${VERSION}"
echo "==========================================="
info "dir: $ROOT"
echo ""

# —— Termux packages ——
if ! command -v pkg >/dev/null 2>&1; then
  yellow "Не схоже на Termux (немає pkg). Став звичайний ./install.sh"
fi

need_pkgs=()
command -v git >/dev/null 2>&1 || need_pkgs+=(git)
command -v node >/dev/null 2>&1 || need_pkgs+=(nodejs)
command -v npm >/dev/null 2>&1 || need_pkgs+=(nodejs)
if [ "${#need_pkgs[@]}" -gt 0 ] && command -v pkg >/dev/null 2>&1; then
  yellow "📦 pkg install ${need_pkgs[*]}…"
  pkg update -y
  pkg install -y "${need_pkgs[@]}"
fi

if ! command -v node >/dev/null 2>&1; then
  red "Node.js не знайдено. У Termux: pkg install nodejs"
  exit 1
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  red "Потрібен Node 18+, зараз $(node -v). Онови: pkg upgrade nodejs"
  exit 1
fi
green "Node $(node -v)"

# —— Vault name ——
DEFAULT_NAME="${VAULT_NAME:-WattSapDrive}"
if [ -t 0 ] && [ -z "${VAULT_NAME:-}" ]; then
  printf "📛 Назва сховища [%s]: " "$DEFAULT_NAME"
  read -r INPUT_NAME || true
  VAULT_NAME="${INPUT_NAME:-$DEFAULT_NAME}"
else
  VAULT_NAME="$DEFAULT_NAME"
fi
VAULT_NAME="$(printf '%s' "$VAULT_NAME" | tr -d '\r' | sed 's/[[:space:]]\+/ /g;s/^ //;s/ $//' | cut -c1-60)"
[ -n "$VAULT_NAME" ] || VAULT_NAME="WattSapDrive"
green "Vault: ${VAULT_NAME}"

# —— deps ——
mkdir -p auth tmp logs uploads
yellow "📦 npm install…"
npm install --omit=dev

# —— config ——
if [ ! -f app-config.json ]; then
  TOKEN="$(node -e "console.log(require('crypto').randomBytes(8).toString('hex'))")"
  NAME_JSON="$(node -e "console.log(JSON.stringify(process.argv[1]))" "$VAULT_NAME")"
  cat > app-config.json <<EOF
{
  "version": "${VERSION}",
  "auth": { "token": "${TOKEN}", "enabled": true },
  "drive": {
    "name": ${NAME_JSON},
    "defaultFolder": "",
    "maxFileSize": "2gb",
    "provider": "whatsapp"
  },
  "whatsapp": { "group": "", "phone": "" }
}
EOF
  green "app-config.json · token ${TOKEN}"
else
  TOKEN="$(node -e "try{console.log(require('./app-config.json').auth.token||'')}catch{console.log('')}")"
  node -e "
    const fs=require('fs');
    const c=JSON.parse(fs.readFileSync('app-config.json','utf8'));
    c.drive=c.drive||{};
    if(!c.drive.name) c.drive.name=process.argv[1];
    fs.writeFileSync('app-config.json', JSON.stringify(c,null,2));
  " "$VAULT_NAME"
  yellow "app-config.json вже є · token ${TOKEN:-(див. файл)}"
fi

if [ ! -f drive-config.json ]; then
  node -e "
    const fs=require('fs');
    const now=new Date().toISOString();
    fs.writeFileSync('drive-config.json', JSON.stringify({
      version:1, defaultFolder:'', updatedAt:now,
      folders:{'':{path:'',name:'/',createdAt:now,fileCount:0,totalSize:0}},
      files:{}
    }, null, 2));
  "
  green "порожній drive-config.json"
fi

# —— stop old ——
if [ -f tmp/bot.pid ]; then
  OLD="$(cat tmp/bot.pid 2>/dev/null || true)"
  if [ -n "${OLD:-}" ] && kill -0 "$OLD" 2>/dev/null; then
    yellow "Зупиняю старий PID $OLD"
    kill "$OLD" 2>/dev/null || true
    sleep 1
    kill -9 "$OLD" 2>/dev/null || true
  fi
  rm -f tmp/bot.pid
fi
# also kill stray
pkill -f "node.*src/bot.js" 2>/dev/null || true
sleep 1

# —— start (no systemd on Termux) ——
export PORT HOST
: > "$LOG"
nohup node src/bot.js >> "$LOG" 2>&1 &
echo $! > tmp/bot.pid
PID="$(cat tmp/bot.pid)"
sleep 2
if ! kill -0 "$PID" 2>/dev/null; then
  red "Бот не стартував. Дивись логи:"
  tail -30 "$LOG" || true
  exit 1
fi
green "Запущено PID $PID"

# helper script
cat > start-termux.sh <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
mkdir -p logs tmp
if [ -f tmp/bot.pid ] && kill -0 "$(cat tmp/bot.pid)" 2>/dev/null; then
  echo "Вже працює PID $(cat tmp/bot.pid)"
  exit 0
fi
export PORT="${PORT:-3000}" HOST="${HOST:-127.0.0.1}"
nohup node src/bot.js >> logs/bot.out 2>&1 &
echo $! > tmp/bot.pid
echo "Started PID $(cat tmp/bot.pid)"
echo "UI:   http://127.0.0.1:${PORT}"
echo "Pair: http://127.0.0.1:${PORT}/pair"
SH
chmod +x start-termux.sh install-termux.sh 2>/dev/null || true

# open browser if possible
if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "http://${HOST}:${PORT}/pair" >/dev/null 2>&1 || true
fi

echo ""
green "✅ Termux ready"
echo "==========================================="
info "Vault:  ${VAULT_NAME}"
info "UI:     http://${HOST}:${PORT}"
info "Pair:   http://${HOST}:${PORT}/pair   ← ТІЛЬКИ КОД, не QR"
info "Token:  ${TOKEN}"
info "Log:    ${LOG}"
info "Start:  ./start-termux.sh"
echo ""
info "Далі:"
info "  1) відкрий /pair → введи номер → Отримати код"
info "  2) WhatsApp → Повʼязані пристрої → Привʼязати за номером"
info "  3) у UI обери/створи групу-сховище"
info "  4) якщо дерево з ПК: ↧ Каталог там → ↥ Імпорт тут"
echo ""
yellow "Не тисни QR на цьому ж телефоні — він не відкриє WhatsApp."
echo ""
