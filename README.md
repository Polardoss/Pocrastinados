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
| Extension navigateur   | Manifest V3 (Chrome) + TypeScript                  |

## Sources de données

- **Steam** — temps de jeu par jeu via l'API `IPlayerService/GetOwnedGames`
  (clé API + SteamID64, pas d'OAuth).
- **Trakt.tv** — historique séries/films via l'API Trakt (OAuth2, refresh
  token gardé côté serveur). *(à venir)*
- **YouTube** — pas d'API officielle exploitable pour l'historique de
  visionnage : une extension Chrome observe localement les pages YouTube
  visitées et pousse les events vers un endpoint d'ingestion perso.
  *(à venir)*

## État actuel (MVP)

- [x] Setup Next.js + Tailwind + Supabase
- [x] Schéma DB (`steam_sessions`, `steam_playtime_snapshots`, `trakt_watches`, `youtube_events`)
- [x] Fetch Steam (snapshot périodique + calcul des sessions par delta)
- [x] Dashboard MVP (stats Steam : total et répartition par jeu)
- [ ] Intégration Trakt (OAuth2)
- [ ] Extension Chrome + endpoint d'ingestion YouTube
- [ ] Heatmap d'activité globale
- [ ] Récap mensuel façon "Wrapped"

## Prérequis

- [Node.js](https://nodejs.org/) 20 ou plus récent, et npm
- Un compte [Supabase](https://supabase.com/) (tier gratuit suffit)
- Une clé [Steam Web API](https://steamcommunity.com/dev/apikey) et votre
  SteamID64 (récupérable sur [steamid.io](https://steamid.io/))
- Un compte [Vercel](https://vercel.com/) pour le déploiement (optionnel en local)
- *(plus tard)* une application enregistrée sur
  [Trakt.tv](https://trakt.tv/oauth/applications) pour l'OAuth2

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

| Variable                    | Description                                                 |
| ---------------------------- | ------------------------------------------------------------- |
| `SUPABASE_URL`               | URL du projet Supabase (Project Settings > API)               |
| `SUPABASE_SERVICE_ROLE_KEY`  | Clé `service_role` Supabase — **jamais** exposée au client    |
| `STEAM_API_KEY`              | Clé Steam Web API                                              |
| `STEAM_ID64`                 | Votre SteamID64                                                |
| `CRON_SECRET`                | Secret utilisé pour authentifier les appels au cron Steam      |
| `TRAKT_CLIENT_ID`            | *(à venir)* Client ID de l'app Trakt                           |
| `TRAKT_CLIENT_SECRET`        | *(à venir)* Client secret de l'app Trakt                       |
| `TRAKT_REFRESH_TOKEN`        | *(à venir)* Refresh token OAuth2 Trakt                         |
| `YOUTUBE_INGEST_SECRET`      | *(à venir)* Secret partagé avec l'extension Chrome             |

## Base de données (Supabase)

1. Créez un nouveau projet sur [supabase.com](https://supabase.com/).
2. Dans le SQL Editor du projet, exécutez le contenu de
   [`supabase/schema.sql`](supabase/schema.sql) pour créer les tables
   (`steam_sessions`, `steam_playtime_snapshots`, `trakt_watches`,
   `youtube_events`) et la vue `steam_latest_snapshots`.
3. Récupérez `SUPABASE_URL` et la clé `service_role` dans
   *Project Settings > API* et renseignez-les dans `.env.local`.

## Lancer en local

Après avoir configuré `.env.local` et appliqué le schéma :

```bash
# Récupérer un premier snapshot Steam (nécessaire pour avoir des données à afficher)
npm run fetch:steam

# Lancer le serveur de dev
npm run dev
```

Le dashboard est disponible sur [http://localhost:3000](http://localhost:3000)
(redirige vers `/dashboard`).

> Le premier fetch Steam n'affichera que les totaux all-time (Steam ne
> renvoie qu'un cumul, pas d'historique). Les stats "ce mois-ci" apparaissent
> à partir du deuxième fetch, une fois qu'un delta peut être calculé.

### Scripts npm disponibles

| Script                | Description                                          |
| ---------------------- | ------------------------------------------------------ |
| `npm run dev`           | Démarre le serveur de développement Next.js             |
| `npm run build`         | Build de production                                     |
| `npm run start`         | Démarre le serveur en mode production (après build)     |
| `npm run lint`          | Lint du code                                            |
| `npm run fetch:steam`   | Lance un fetch Steam manuel (snapshot + sessions)       |

## Déploiement

### Vercel

1. Importez le repo GitHub dans [Vercel](https://vercel.com/new).
2. Renseignez toutes les variables d'environnement listées ci-dessus dans
   *Project Settings > Environment Variables*.
3. Déployez. Le fichier [`vercel.json`](vercel.json) configure un Cron Job
   Vercel qui appelle `/api/cron/steam` toutes les 6 heures.
4. Vercel envoie automatiquement l'en-tête
   `Authorization: Bearer <CRON_SECRET>` lors du déclenchement du cron tant
   que `CRON_SECRET` est configuré sur le projet — c'est ce que la route
   vérifie pour refuser les appels non autorisés.

### Supabase

Le projet Supabase créé pour le développement peut être réutilisé tel quel
en production (tier gratuit) : il n'y a rien de plus à déployer côté base de
données au-delà du schéma SQL déjà appliqué.

## Structure du projet

```
Pocrastinados/
├── src/
│   ├── app/
│   │   ├── page.tsx              # redirige vers /dashboard
│   │   ├── dashboard/page.tsx    # dashboard MVP (stats Steam)
│   │   └── api/cron/steam/       # endpoint appelé par Vercel Cron
│   └── lib/
│       ├── supabase-admin.ts     # client Supabase (service role, server-only)
│       ├── steam.ts              # fetch Steam + calcul des sessions par delta
│       ├── dashboard-data.ts     # agrégation des données pour le dashboard
│       └── format.ts             # helpers de formatage (durées)
├── scripts/
│   └── fetch-steam.ts            # lance un fetch Steam en local (npm run fetch:steam)
├── supabase/
│   └── schema.sql                # schéma DB à appliquer sur le projet Supabase
├── vercel.json                   # config du Cron Job Vercel
├── .env.example                  # liste des variables d'environnement
└── extension/                    # (à venir) extension Chrome pour le tracking YouTube
```

## Sécurité

- Toutes les clés/secrets vivent dans des variables d'environnement, jamais
  en dur dans le code.
- Row Level Security est activé sur toutes les tables sans policy : seule la
  clé `service_role` (utilisée uniquement côté serveur) peut lire/écrire les
  données. Le dashboard lit Supabase depuis des Server Components, jamais
  depuis le navigateur.
