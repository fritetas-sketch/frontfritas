# FrontFritas 🍟

Un jeu de **conquête territoriale en temps réel** jouable dans le navigateur,
inspiré de [OpenFront.io](https://openfront.io/) / territorial.io.

Étends ton territoire, gère tes troupes et écrase les bots pour dominer la
carte. **Un site = une partie** : chaque session lance une seule partie.

![gameplay](https://img.shields.io/badge/status-jouable-brightgreen)

## Lancer le projet

```bash
npm install
npm run dev      # serveur de dev → http://localhost:5173
npm run build    # build de production dans dist/
npm run preview  # sert le build de production
```

## Comment jouer

- **Clic gauche** sur une case pour **attaquer** un ennemi ou **s'étendre**
  sur du terrain neutre. L'attaque part de toute ta frontière vers la cible.
- **Curseur « Attaque »** : règle le pourcentage de troupes engagées.
- **Molette** : zoom · **Clic droit (glisser)** ou **ZQSD/WASD/flèches** :
  déplacer la caméra.
- Tes **troupes** croissent avec la taille de ton territoire (croissance
  logistique plafonnée). Plus ton empire est grand, plus t'étendre coûte cher.
- Gagne en éliminant tous les autres joueurs.

## Connexion Discord (optionnelle)

Un bouton **« Connexion via Discord »** utilise le flux OAuth2 *implicit grant*
— 100 % côté navigateur, sans backend ni secret. Il pré-remplit ton pseudo à
partir de ton compte Discord.

Pour l'activer, crée une application Discord, ajoute l'URL de ton site comme
*redirect* OAuth2, puis fournis le client id au build :

```bash
# .env
VITE_DISCORD_CLIENT_ID=123456789012345678
```

Sans client id configuré, le bouton reste masqué et le jeu est entièrement
jouable avec un pseudo manuel.

## Architecture

Aucune dépendance runtime — TypeScript + Canvas 2D purs, bundlés par Vite.

| Fichier            | Rôle                                                        |
| ------------------ | ----------------------------------------------------------- |
| `src/game.ts`      | Moteur : état, expansion BFS, combat, croissance, IA des bots |
| `src/mapgen.ts`    | Génération de carte (automate cellulaire → îles organiques) |
| `src/render.ts`    | Rendu Canvas (buffer de pixels + caméra zoom/pan + labels)  |
| `src/main.ts`      | Boucle de jeu, entrées souris/clavier, menu et HUD          |
| `src/discord.ts`   | Connexion Discord OAuth2 optionnelle                        |
| `src/palette.ts`   | Couleurs et noms des joueurs                                 |
| `src/rng.ts`       | PRNG seedable (Mulberry32) pour des cartes reproductibles    |

### Modèle de jeu

- La carte est une grille de tuiles (`terrain` eau/terre, `owner` par tuile).
- Une **attaque** engage une armée qui conquiert les tuiles de la cible via un
  front BFS. Le terrain neutre a un coût fixe (croissant avec ta taille) ; une
  tuile ennemie coûte selon la densité de troupes du défenseur, qui perd la
  garnison correspondante. Un joueur sans tuile est éliminé.
- Les bots analysent périodiquement leur frontière et choisissent d'attaquer
  le voisin le plus faible ou de s'étendre sur le neutre.

## Pistes d'extension

Multijoueur serveur, bateaux/débarquements, villes & ports, nukes, alliances,
arbre technologique, brouillard de guerre.
