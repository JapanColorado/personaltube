#!/usr/bin/env bash
# Install a systemd *user* service that keeps the server running at http://127.0.0.1:8765 from login on.
# Re-run any time; it overwrites the unit. Remove with: scripts/install_systemd.sh --uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIXI="$(command -v pixi || echo "$HOME/.pixi/bin/pixi")"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT=personaltube.service

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl --user disable --now "$UNIT" 2>/dev/null || true
  rm -f "$UNIT_DIR/$UNIT"
  systemctl --user daemon-reload
  echo "Removed."
  exit 0
fi

mkdir -p "$UNIT_DIR"

# The server restarts its own worker when a .py file changes (also when Syncthing brings one in),
# so the service only needs restarting by hand after a change to pixi.toml.
cat > "$UNIT_DIR/$UNIT" <<EOF
[Unit]
Description=PersonalTube on http://127.0.0.1:8765

[Service]
WorkingDirectory=$ROOT
ExecStart=$PIXI run start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT"
systemctl --user --no-pager status "$UNIT" | head -n 5

if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]]; then
  echo
  echo "Note: this runs only while you're logged in. To keep it running after you log out:"
  echo "  loginctl enable-linger $USER"
fi
