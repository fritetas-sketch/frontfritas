#!/usr/bin/env bash
#
# FrontFritas — installateur VPS tout-en-un.
#
# Copie CE SEUL fichier sur ton VPS puis lance-le en root :
#     sudo bash install.sh
#
# Il installe Node + Caddy si besoin, récupère le code, build le jeu, crée un
# service systemd et configure le HTTPS automatique pour ton domaine.
#
# Tu peux tout régler par variables d'environnement, ex :
#     sudo DOMAIN=front.fritas.fr REPO_URL=https://github.com/fritetas-sketch/frontfritas.git bash install.sh
#
set -euo pipefail

# ------------------------------------------------------------------ réglages
DOMAIN="${DOMAIN:-front.fritas.fr}"
REPO_URL="${REPO_URL:-https://github.com/fritetas-sketch/frontfritas.git}"
BRANCH="${BRANCH:-claude/openfront-recreation-aowq8z}"
APP_DIR="${APP_DIR:-/opt/frontfritas}"
APP_USER="${APP_USER:-frontfritas}"
PORT="${PORT:-8787}"
# Mets DISCORD_CLIENT_ID=... pour activer le bouton Discord (optionnel).
DISCORD_CLIENT_ID="${DISCORD_CLIENT_ID:-}"

log() { echo -e "\033[1;33m▶ $*\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "Lance ce script en root : sudo bash install.sh" >&2
  exit 1
fi

# ------------------------------------------------------------- dépendances
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 18 ]]; then
  log "Installation de Node.js 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
log "Node $(node -v), npm $(npm -v)"

if ! command -v git >/dev/null 2>&1; then
  log "Installation de git…"
  apt-get install -y git
fi

if ! command -v caddy >/dev/null 2>&1; then
  log "Installation de Caddy (HTTPS automatique)…"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# --------------------------------------------------------------- récupération
if [[ -d "$APP_DIR/.git" ]]; then
  log "Mise à jour du dépôt dans $APP_DIR…"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  log "Clonage de $REPO_URL (branche $BRANCH)…"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

# ------------------------------------------------------------------- build
cd "$APP_DIR"
log "Installation des dépendances et build…"
if [[ -n "$DISCORD_CLIENT_ID" ]]; then
  export VITE_DISCORD_CLIENT_ID="$DISCORD_CLIENT_ID"
fi
npm ci
npm run build

# ------------------------------------------------------------- utilisateur
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Création de l'utilisateur système $APP_USER…"
  useradd -r -s /usr/sbin/nologin "$APP_USER"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --------------------------------------------------------------- systemd
log "Configuration du service systemd…"
cat > /etc/systemd/system/frontfritas.service <<EOF
[Unit]
Description=FrontFritas game server
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) dist-server/server.mjs
Environment=NODE_ENV=production
Environment=PORT=$PORT
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now frontfritas
systemctl restart frontfritas

# ---------------------------------------------------------------- Caddy
log "Configuration de Caddy pour $DOMAIN…"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	reverse_proxy localhost:$PORT
}
EOF
systemctl reload caddy || systemctl restart caddy

# ------------------------------------------------------------------- fin
echo
log "Terminé ✅"
echo "  • Vérifie le serveur :   journalctl -u frontfritas -f"
echo "  • Le jeu :               https://$DOMAIN"
echo
echo "  Assure-toi qu'un enregistrement DNS A (et AAAA) '$DOMAIN' pointe vers"
echo "  l'IP de ce VPS — Caddy génère le certificat TLS automatiquement."
