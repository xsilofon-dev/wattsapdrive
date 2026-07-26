#!/usr/bin/env bash
set -e

echo "🚀 WattSapDrive Installer v0.2.0"
echo "=================================="

# Check node
if ! command -v node &>/dev/null; then
    echo "❌ Node.js not found. Install: https://nodejs.org"
    exit 1
fi
echo "✅ Node $(node -v)"

# Install deps
echo "📦 Installing packages..."
npm install --omit=dev 2>/dev/null

# Auth
echo "🔑 Auth token: YOUR_TOKEN"
echo "   (change in drive-config.json → auth.token)"

# Setup systemd
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/wattsapdrive.service" << UNIT
[Unit]
Description=WattSapDrive
After=network.target
[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$(which node) src/bot.js
Restart=always
RestartSec=5
[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now wattsapdrive

echo ""
echo "✅ WattSapDrive installed!"
echo "🌐 Open: http://localhost:3000"
echo "📱 QR:   http://localhost:3000/qr"
echo "🔑 Auth: YOUR_TOKEN"
echo ""
echo "📁 Upload: curl -H 'Authorization: Bearer YOUR_TOKEN' -H 'x-file-name: myfile.txt' --data-binary @file http://localhost:3000/api/upload"
