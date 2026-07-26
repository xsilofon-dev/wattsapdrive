#!/usr/bin/env bash
# WattSapDrive — one-shot installer for a clean machine
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VERSION="0.3.0"
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
SERVICE_NAME="wattsapdrive"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

echo ""
echo "☁  WattSapDrive Installer v${VERSION}"
echo "=================================="
info "dir: $ROOT"
echo ""

# —— Node.js ——
if ! command -v node >/dev/null 2>&1; then
  red "Node.js not found."
  info "Install Node 18+: https://nodejs.org  (or: nix, apt, brew, nvm)"
  exit 1
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  red "Need Node.js 18+, got $(node -v)"
  exit 1
fi
green "Node $(node -v) · npm $(npm -v 2>/dev/null || echo '?')"

# —— Dependencies ——
echo ""
yellow "📦 npm install…"
npm install --omit=dev

# —— Runtime dirs ——
mkdir -p auth tmp logs uploads

# —— Storage / vault name ——
echo ""
DEFAULT_NAME="${VAULT_NAME:-WattSapDrive}"
if [ -t 0 ] && [ -z "${VAULT_NAME:-}" ]; then
  printf "📛 Назва сховища [%s]: " "$DEFAULT_NAME"
  read -r INPUT_NAME || true
  VAULT_NAME="${INPUT_NAME:-$DEFAULT_NAME}"
else
  VAULT_NAME="$DEFAULT_NAME"
fi
# sanitize
VAULT_NAME="$(printf '%s' "$VAULT_NAME" | tr -d '\r' | sed 's/[[:space:]]\+/ /g;s/^ //;s/ $//' | cut -c1-60)"
[ -n "$VAULT_NAME" ] || VAULT_NAME="WattSapDrive"
green "Vault name: ${VAULT_NAME}"

# —— app-config.json (token) ——
if [ ! -f app-config.json ]; then
  TOKEN="$(node -e "console.log(require('crypto').randomBytes(8).toString('hex'))")"
  # escape JSON string
  NAME_JSON="$(node -e "console.log(JSON.stringify(process.argv[1]))" "$VAULT_NAME")"
  cat > app-config.json <<EOF
{
  "version": "${VERSION}",
  "auth": {
    "token": "${TOKEN}",
    "enabled": true
  },
  "drive": {
    "name": ${NAME_JSON},
    "defaultFolder": "",
    "maxFileSize": "2gb",
    "provider": "whatsapp"
  },
  "whatsapp": {
    "group": "",
    "phone": ""
  }
}
EOF
  green "Created app-config.json · token ${TOKEN}"
else
  TOKEN="$(node -e "try{console.log(require('./app-config.json').auth.token||'')}catch{console.log('')}")"
  node -e "
    const fs=require('fs');
    const p='app-config.json';
    const c=JSON.parse(fs.readFileSync(p,'utf8'));
    c.drive=c.drive||{};
    if(!c.drive.name) c.drive.name=process.argv[1];
    fs.writeFileSync(p, JSON.stringify(c,null,2));
  " "$VAULT_NAME"
  yellow "app-config.json already exists · token ${TOKEN:-(see file)}"
fi

# —— empty catalog if missing ——
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
  green "Created empty drive-config.json"
fi

# —— systemd user unit (Linux) ——
install_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    yellow "systemctl not found — skip service (start manually: npm start)"
    return 1
  fi
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    yellow "systemd --user unavailable — skip service"
    return 1
  fi

  NODE_BIN="$(command -v node)"
  SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$SERVICE_DIR"
  cat > "$SERVICE_DIR/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=WattSapDrive — WhatsApp cloud storage
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${NODE_BIN} ${ROOT}/src/bot.js
Restart=on-failure
RestartSec=4
Environment=PORT=${PORT}
Environment=HOST=${HOST}
Environment=NODE_ENV=production
# Keep logs out of journal spam if needed: StandardOutput=append:${ROOT}/logs/bot.out

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable --now "${SERVICE_NAME}.service"

  # Survive logout (optional, ignore errors on non-systemd or no linger support)
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true
  fi

  green "systemd user service: ${SERVICE_NAME}.service (enabled + started)"
  return 0
}

echo ""
yellow "🔧 systemd…"
if install_systemd; then
  sleep 1
  systemctl --user --no-pager --full status "${SERVICE_NAME}.service" | head -12 || true
else
  yellow "Starting in background via nohup…"
  nohup node src/bot.js >> logs/bot.out 2>&1 &
  echo $! > tmp/bot.pid
  green "PID $(cat tmp/bot.pid) · logs/bot.out"
fi

echo ""
green "✅ WattSapDrive ready"
echo "=================================="
info "Vault:  ${VAULT_NAME}"
info "UI:     http://${HOST}:${PORT}"
info "Pair:   http://${HOST}:${PORT}/pair   ← Termux / телефон (код, не QR)"
info "QR:     http://${HOST}:${PORT}/qr"
info "Token:  ${TOKEN}"
echo ""
info "Next:"
info "  1) /pair → код у WhatsApp (Link with phone number)"
info "  2) у UI обери або створи групу-сховище (інакше файли підуть у «Обране»)"
info "  3) keep WhatsApp Desktop closed on this machine (avoids 440)"
echo ""
info "Useful:"
info "  systemctl --user status ${SERVICE_NAME}"
info "  systemctl --user restart ${SERVICE_NAME}"
info "  journalctl --user -u ${SERVICE_NAME} -f"
info "  curl -s http://${HOST}:${PORT}/api/status | jq ."
echo ""
