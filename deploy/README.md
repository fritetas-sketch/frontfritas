# Déployer FrontFritas sur ton VPS (`front.fritas.fr`)

Le serveur Node sert **le client statique et le WebSocket sur le même port**.
Le client se connecte donc tout seul à `wss://front.fritas.fr` une fois servi
en HTTPS. Il te faut juste un reverse-proxy TLS devant le serveur.

**Prérequis DNS** : un enregistrement **A** (et **AAAA** si IPv6)
`front.fritas.fr` pointant vers l'IP de ton VPS.

Deux méthodes — choisis-en une.

---

## Méthode A — systemd + Caddy (sans Docker)

```bash
# 1. Récupérer le code sur le VPS
sudo mkdir -p /opt/frontfritas && cd /opt/frontfritas
git clone <ton-repo> .            # ou rsync/scp du projet
git checkout claude/openfront-recreation-aowq8z

# 2. Node 18+ requis (le serveur de prod est du JS bundlé, pas de flag spécial)
npm ci
npm run build                     # génère dist/ (client) et dist-server/ (serveur)

# 3. Service systemd
sudo useradd -r -s /usr/sbin/nologin frontfritas || true
sudo chown -R frontfritas:frontfritas /opt/frontfritas
sudo cp deploy/frontfritas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now frontfritas
journalctl -u frontfritas -f      # vérifier "FrontFritas server on ..."

# 4. Caddy (HTTPS automatique + proxy WebSocket)
sudo apt install -y caddy         # ou https://caddyserver.com/docs/install
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Ouvre `https://front.fritas.fr` — c'est en ligne.

> Node < 22 sur le VPS ? Pas de souci : la prod utilise `dist-server/server.mjs`
> (JS pur). Le flag `--experimental-strip-types` ne sert qu'au dev
> (`npm run server`).

---

## Méthode B — Docker Compose (serveur + Caddy en conteneurs)

```bash
sudo mkdir -p /opt/frontfritas && cd /opt/frontfritas
git clone <ton-repo> . && git checkout claude/openfront-recreation-aowq8z

docker compose -f deploy/docker-compose.yml up -d --build
```

Caddy obtient le certificat TLS automatiquement au premier démarrage. Pour
activer Discord, ajoute l'argument de build :

```bash
docker compose -f deploy/docker-compose.yml build \
  --build-arg VITE_DISCORD_CLIENT_ID=ton_client_id
docker compose -f deploy/docker-compose.yml up -d
```

---

## Alternative : Nginx au lieu de Caddy

Si tu préfères Nginx (avec certbot pour le TLS), l'essentiel est de **relayer
l'upgrade WebSocket** :

```nginx
server {
    server_name front.fritas.fr;
    listen 443 ssl;
    # ... ssl_certificate / ssl_certificate_key (certbot) ...

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## Mettre à jour

```bash
cd /opt/frontfritas && git pull
npm ci && npm run build
sudo systemctl restart frontfritas     # (méthode A)
# ou : docker compose -f deploy/docker-compose.yml up -d --build   (méthode B)
```

## Discord (optionnel)

Dans le portail développeur Discord, ajoute `https://front.fritas.fr` comme
*redirect* OAuth2, puis fournis `VITE_DISCORD_CLIENT_ID` **avant** `npm run
build` (variable lue au build). Sans ça, le bouton reste masqué.
