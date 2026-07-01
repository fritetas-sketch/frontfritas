# FrontFritas 🍟

Un jeu de **conquête territoriale en temps réel** jouable dans le navigateur,
inspiré de [OpenFront.io](https://openfront.io/) / territorial.io.

Étends ton territoire, gère tes troupes et écrase l'adversaire pour dominer la
carte — **en solo contre des bots** ou **en ligne entre toi et tes viewers**.
Un salon = une partie.

## Lancer en local

```bash
npm install
npm run dev      # client (Vite) → http://localhost:5173
npm run server   # serveur multijoueur → http://localhost:8787

# ou tout-en-un (build + serveur qui sert le client ET le WebSocket)
npm run start    # → http://localhost:8787
```

Pour le **solo**, `npm run dev` suffit. Pour le **multijoueur**, lance aussi
`npm run server` (en dev le client se connecte à `ws://localhost:8787`).

## Comment jouer

- **Clic gauche** sur une case : **attaquer** un ennemi ou **s'étendre** sur du
  terrain neutre. L'attaque part de toute ta frontière vers la cible.
- **Curseur « Attaque »** : pourcentage de troupes engagées.
- **Molette** : zoom · **Clic droit (glisser)** ou **ZQSD/WASD/flèches** :
  déplacer la caméra.
- Tes **troupes** croissent avec ton territoire (croissance logistique
  plafonnée). Plus ton empire est grand, plus t'étendre coûte cher.
- Gagne en éliminant tous les autres joueurs.

## Multijoueur (streamer + viewers)

Architecture **serveur autoritatif** : le serveur fait tourner la simulation,
les clients envoient leurs commandes et reçoivent l'état. Tout le monde reste
synchronisé, sans triche possible.

1. **Toi (hôte)** : « Créer un salon » → tu obtiens un **code à 4 lettres**.
2. **Tes viewers** : ils ouvrent le site, entrent le code (ou le lien
   `…/?room=CODE` qui le pré-remplit) et « Rejoindre ».
3. Tu cliques **« Démarrer »**. Les places restantes sont comblées par des bots.
4. Les **retardataires** rejoignent en **spectateurs**. Si un joueur se
   déconnecte, l'**IA reprend** son territoire pour ne pas bloquer la partie.

Seuls l'appartenance des cases et les stats transitent sur le réseau : le
terrain est régénéré à l'identique chez chaque client à partir de la *seed*
partagée (génération déterministe), ce qui garde la bande passante minimale.

## Connexion Discord (optionnelle)

Le bouton **« Connexion via Discord »** utilise le flux OAuth2 *implicit grant*
— 100 % côté navigateur, sans backend ni secret. Il pré-remplit ton pseudo.
Configure le client id (voir `.env.example`) ; sans lui, le bouton reste masqué.

## Déploiement sur `front.fritas.fr`

Le serveur Node sert **à la fois** le client statique (`dist/`) et le WebSocket
sur le **même port/origine**, donc le client se connecte tout seul à
`wss://front.fritas.fr` une fois servi en HTTPS.

```bash
npm ci && npm run build          # génère dist/
PORT=8787 npm run server         # lance le serveur (via systemd, pm2, docker…)
caddy run --config deploy/Caddyfile   # TLS auto + reverse proxy WebSocket
```

1. Crée un enregistrement DNS **A/AAAA** `front.fritas.fr` → ton serveur.
2. `deploy/Caddyfile` fournit le certificat HTTPS et proxifie vers le port Node
   (upgrade WebSocket inclus). Un Nginx avec `proxy_set_header Upgrade`
   fonctionne aussi.
3. Si tu utilises Discord : ajoute `https://front.fritas.fr` comme *redirect*
   OAuth2 et renseigne `VITE_DISCORD_CLIENT_ID` avant `npm run build`.

## Architecture

Aucune dépendance runtime côté client — TypeScript + Canvas 2D purs (bundlés par
Vite). Serveur : Node + `ws`, exécuté via `--experimental-strip-types`.

| Fichier            | Rôle                                                          |
| ------------------ | ------------------------------------------------------------ |
| `src/game.ts`      | Moteur : état, expansion BFS, combat, croissance, IA des bots |
| `src/mapgen.ts`    | Génération de carte (automate cellulaire → îles organiques)   |
| `src/render.ts`    | Rendu Canvas (buffer de pixels + caméra zoom/pan + labels)    |
| `src/world.ts`     | Vue client d'une partie réseau (carte reconstruite, deltas)   |
| `src/net.ts`       | Client WebSocket                                              |
| `src/protocol.ts`  | Messages et constantes partagés client/serveur               |
| `src/main.ts`      | Boucle de jeu, entrées, menu, lobby et HUD                    |
| `src/discord.ts`   | Connexion Discord OAuth2 optionnelle                          |
| `server/index.ts`  | Serveur autoritatif : salons, simulation, broadcast d'état    |

### Modèle de jeu

- La carte est une grille de tuiles (`terrain` eau/terre, `owner` par tuile).
- Une **attaque** engage une armée qui conquiert les tuiles de la cible via un
  front BFS. Le neutre a un coût fixe (croissant avec ta taille) ; une tuile
  ennemie coûte selon la densité du défenseur, qui perd la garnison
  correspondante. Un joueur sans tuile est éliminé.
- Les bots analysent leur frontière et choisissent d'attaquer le voisin le plus
  faible ou de s'étendre sur le neutre.

## Pistes d'extension

Bateaux/débarquements, villes & ports, nukes, alliances, arbre technologique,
brouillard de guerre, persistance des comptes Discord (backend).
