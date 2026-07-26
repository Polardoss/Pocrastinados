# Pocrastinados

Dashboard personnel qui agrège mon activité de divertissement (jeux vidéo,
séries/films, YouTube) pour visualiser mes stats dans le temps : temps passé
par catégorie, heatmap d'activité façon "GitHub contributions", récaps
mensuels façon "Wrapped".

Projet perso, usage solo, pensé pour tourner sur des tiers gratuits
(Vercel + Supabase).

## Stack technique

| Composant             | Techno                                            |
| ---------------------- | -------------------------------------------------- |
| Frontend               | Next.js (App Router) + TypeScript + Tailwind CSS   |
| Backend                | Next.js Route Handlers (API routes) + Vercel Cron  |
| Base de données        | PostgreSQL via Supabase (tier gratuit)             |
| Hébergement            | Vercel                                             |
| Extension navigateur   | Manifest V3 (Chrome) + TypeScript + esbuild        |

## Sources de données

- **Steam** — temps de jeu par jeu via l'API `IPlayerService/GetOwnedGames`
  (clé API + SteamID64, pas d'OAuth). Steam ne renvoyant qu'un cumul total
  (pas d'historique de sessions), chaque fetch enregistre un snapshot et une
  "session" est dérivée du delta avec le snapshot précédent.
- **Trakt.tv** — historique séries/films via l'API Trakt. Auth OAuth2 par
  device code flow (pas de callback URL nécessaire) ; le refresh token est
  stocké et renouvelé automatiquement côté Supabase, jamais exposé au client.
- **YouTube** — pas d'API officielle exploitable pour l'historique de
  visionnage : une extension Chrome ([`extension/`](extension)) observe
  localement les pages YouTube visitées (titre, chaîne, durée regardée
  estimée à partir de l'état de lecture de la vidéo) et pousse les events
  vers un endpoint d'ingestion perso, authentifié par secret partagé.

## État actuel

- [x] Setup Next.js + Tailwind + Supabase
- [x] Schéma DB (`steam_sessions`, `steam_playtime_snapshots`, `trakt_tokens`, `trakt_watches`, `youtube_events`)
- [x] Fetch Steam (snapshot périodique + calcul des sessions par delta)
- [x] Intégration Trakt (device code OAuth2 + sync d'historique + refresh automatique)
- [x] Extension Chrome (Manifest V3) + endpoint d'ingestion YouTube
- [x] Dashboard : stats Steam, Trakt et YouTube (total + répartition, all-time et ce mois-ci)
- [x] Heatmap d'activité globale (façon GitHub contributions, toutes sources combinées)
- [x] Récap mensuel façon "Wrapped" (`/wrapped`)
- [x] Répartition hebdomadaire du temps par catégorie
- [ ] Déploiement en production (Vercel + Supabase) — étape manuelle, voir plus bas
- [ ] *(Optionnel)* Authentification perso si le dashboard doit être accessible depuis plusieurs devices

## Prérequis

- [Node.js](https://nodejs.org/) 20 ou plus récent, et npm
- Un compte [Supabase](https://supabase.com/) (tier gratuit suffit)
- Une clé [Steam Web API](https://steamcommunity.com/dev/apikey) et votre
  SteamID64 (récupérable sur [steamid.io](https://steamid.io/))
- Une application enregistrée sur
  [Trakt.tv](https://trakt.tv/oauth/applications) (redirect URI arbitraire,
  non utilisée par le flow device code)
- Un compte [Vercel](https://vercel.com/) pour le déploiement (optionnel en local)
- Google Chrome (ou un navigateur Chromium) pour l'extension YouTube

## Installation

```bash
git clone https://github.com/Polardoss/Pocrastinados.git
cd Pocrastinados
npm install
```

Copiez ensuite le fichier d'exemple d'environnement :

```bash
cp .env.example .env.local
```

## Variables d'environnement

Toutes les variables sont listées (sans valeurs) dans
[`.env.example`](.env.example). Ne jamais commiter `.env.local` (déjà
ignoré par `.gitignore`).

| Variable                    | Description                                                          |
| ---------------------------- | ----------------------------------------------------------------------- |
| `SUPABASE_URL`               | URL du projet Supabase (Project Settings > API)                        |
| `SUPABASE_SERVICE_ROLE_KEY`  | Clé `service_role` Supabase — **jamais** exposée au client              |
| `STEAM_API_KEY`              | Clé Steam Web API                                                       |
| `STEAM_ID64`                 | Votre SteamID64                                                         |
| `CRON_SECRET`                | Secret utilisé pour authentifier les appels aux crons Steam et Trakt    |
| `TRAKT_CLIENT_ID`            | Client ID de l'app Trakt                                                |
| `TRAKT_CLIENT_SECRET`        | Client secret de l'app Trakt                                            |
| `YOUTUBE_INGEST_SECRET`      | Secret partagé avec l'extension Chrome pour authentifier l'ingestion    |

Il n'y a pas de variable pour le refresh token Trakt : après avoir renseigné
`TRAKT_CLIENT_ID`/`TRAKT_CLIENT_SECRET`, `npm run trakt:authorize` s'occupe
de l'obtenir et de le stocker (voir plus bas).

## Base de données (Supabase)

1. Créez un nouveau projet sur [supabase.com](https://supabase.com/).
2. Dans le SQL Editor du projet, exécutez le contenu de
   [`supabase/schema.sql`](supabase/schema.sql) pour créer les tables
   (`steam_sessions`, `steam_playtime_snapshots`, `trakt_tokens`,
   `trakt_watches`, `youtube_events`) et la vue `steam_latest_snapshots`.
3. Récupérez `SUPABASE_URL` et la clé `service_role` dans
   *Project Settings > API* et renseignez-les dans `.env.local`.

## Lancer en local

Après avoir configuré `.env.local` et appliqué le schéma :

```bash
# Récupérer un premier snapshot Steam (nécessaire pour avoir des données à afficher)
npm run fetch:steam

# Autoriser Trakt une fois (ouvre un code à saisir sur trakt.tv/activate)
npm run trakt:authorize
npm run fetch:trakt

# Lancer le serveur de dev
npm run dev
```

Le dashboard est disponible sur [http://localhost:3000](http://localhost:3000)
(redirige vers `/dashboard`) ; le récap mensuel est sur `/wrapped`.

> Le premier fetch Steam n'affiche que les totaux all-time (Steam ne renvoie
> qu'un cumul, pas d'historique). Les stats "ce mois-ci" pour Steam
> apparaissent à partir du deuxième fetch, une fois qu'un delta peut être
> calculé. Trakt et YouTube n'ont pas cette limitation : leurs événements
> sont horodatés dès la première synchronisation.

### Extension Chrome (tracking YouTube)

```bash
npm run build:extension
```

Puis dans Chrome : `chrome://extensions` → activer le *mode développeur* →
*Charger l'extension non empaquetée* → sélectionner le dossier
`extension/dist`. Ouvrez ensuite les options de l'extension et renseignez :

- **Ingest URL** : `https://<votre-app>.vercel.app/api/ingest/youtube`
  (ou `http://localhost:3000/api/ingest/youtube` en local)
- **Secret** : la même valeur que `YOUTUBE_INGEST_SECRET`

L'extension observe les pages `youtube.com/watch`, accumule le temps de
lecture réel (basé sur l'état play/pause de la vidéo, échantillonné toutes
les 5s) et envoie les événements par lot toutes les 5 minutes.

### Scripts npm disponibles

| Script                   | Description                                              |
| ------------------------- | ----------------------------------------------------------- |
| `npm run dev`              | Démarre le serveur de développement Next.js                 |
| `npm run build`            | Build de production                                         |
| `npm run start`            | Démarre le serveur en mode production (après build)         |
| `npm run lint`             | Lint du code                                                |
| `npm run fetch:steam`      | Lance un fetch Steam manuel (snapshot + sessions)            |
| `npm run fetch:trakt`      | Lance une synchronisation Trakt manuelle                     |
| `npm run trakt:authorize`  | Autorisation Trakt one-shot (device code flow)               |
| `npm run build:extension`  | Build l'extension Chrome dans `extension/dist`               |

## Déploiement

### Vercel

1. Importez le repo GitHub dans [Vercel](https://vercel.com/new).
2. Renseignez toutes les variables d'environnement listées ci-dessus dans
   *Project Settings > Environment Variables*.
3. Déployez. Le fichier [`vercel.json`](vercel.json) configure deux Cron Jobs
   Vercel (`/api/cron/steam` et `/api/cron/trakt`), une fois par jour chacun —
   le plan Hobby de Vercel limite les cron jobs à une exécution quotidienne.
   Vous pouvez toujours déclencher un fetch manuel via `npm run fetch:steam`
   / `npm run fetch:trakt` en local, ou passer à un plan payant pour une
   fréquence plus élevée.
4. Vercel envoie automatiquement l'en-tête
   `Authorization: Bearer <CRON_SECRET>` lors du déclenchement des crons tant
   que `CRON_SECRET` est configuré sur le projet — c'est ce que chaque route
   vérifie pour refuser les appels non autorisés.
5. Mettez à jour l'URL d'ingestion dans les options de l'extension Chrome
   pour pointer vers votre domaine Vercel.

### Supabase

Le projet Supabase créé pour le développement peut être réutilisé tel quel
en production (tier gratuit) : il n'y a rien de plus à déployer côté base de
données au-delà du schéma SQL déjà appliqué.

## Structure du projet

```
Pocrastinados/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # redirige vers /dashboard
│   │   ├── dashboard/page.tsx        # dashboard principal (Steam + Trakt + YouTube)
│   │   ├── wrapped/                  # récap mensuel ("Wrapped")
│   │   └── api/
│   │       ├── cron/steam/           # endpoint appelé par Vercel Cron (Steam)
│   │       ├── cron/trakt/           # endpoint appelé par Vercel Cron (Trakt)
│   │       └── ingest/youtube/       # endpoint d'ingestion pour l'extension Chrome
│   ├── components/
│   │   ├── activity-heatmap.tsx      # heatmap façon GitHub contributions
│   │   └── weekly-breakdown.tsx      # répartition hebdomadaire par catégorie
│   └── lib/
│       ├── supabase-admin.ts         # client Supabase (service role, server-only)
│       ├── steam.ts                  # fetch Steam + calcul des sessions par delta
│       ├── trakt.ts                  # refresh token + sync d'historique Trakt
│       ├── dashboard-data.ts         # agrégation des données pour le dashboard
│       └── format.ts                 # helpers de formatage (durées)
├── scripts/
│   ├── fetch-steam.ts                # fetch Steam en local (npm run fetch:steam)
│   ├── fetch-trakt.ts                # sync Trakt en local (npm run fetch:trakt)
│   ├── trakt-authorize.ts            # autorisation Trakt one-shot (device code flow)
│   └── build-extension.ts            # build l'extension Chrome (esbuild)
├── extension/                        # extension Chrome (Manifest V3) — tracking YouTube
│   ├── manifest.json
│   └── src/
│       ├── content.ts                # observe les pages youtube.com/watch
│       ├── background.ts             # queue + envoie les events au backend
│       └── options.ts                # config (URL + secret d'ingestion)
├── supabase/
│   └── schema.sql                    # schéma DB à appliquer sur le projet Supabase
├── vercel.json                       # config des Cron Jobs Vercel
├── .env.example                      # liste des variables d'environnement
└── .claude/launch.json               # config du serveur de dev (outillage Claude Code)
```

## Sécurité

- Toutes les clés/secrets vivent dans des variables d'environnement, jamais
  en dur dans le code.
- Row Level Security est activé sur toutes les tables sans policy : seule la
  clé `service_role` (utilisée uniquement côté serveur) peut lire/écrire les
  données. Le dashboard lit Supabase depuis des Server Components, jamais
  depuis le navigateur.
- Les endpoints `/api/cron/*` et `/api/ingest/youtube` exigent un secret
  partagé (`CRON_SECRET` / `YOUTUBE_INGEST_SECRET`) envoyé en
  `Authorization: Bearer <secret>` ; sans ce secret configuré, les routes
  refusent toute requête plutôt que de rester ouvertes par défaut.
- Le refresh token Trakt n'est jamais stocké dans une variable d'environnement
  statique (il tourne à chaque renouvellement) : il vit uniquement dans
  Supabase, lu et écrit côté serveur.
