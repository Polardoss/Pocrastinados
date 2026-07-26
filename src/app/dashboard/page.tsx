import { getSteamDashboardData, type GameTotal } from "@/lib/dashboard-data";
import { formatMinutes } from "@/lib/format";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-[#111]">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function GameTable({ title, games }: { title: string; games: GameTotal[] }) {
  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-[#111]">
      <h2 className="text-lg font-semibold">{title}</h2>
      {games.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Pas encore de données.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-black/[.06] dark:divide-white/[.08]">
          {games.map((game) => (
            <li
              key={game.appid}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span className="truncate pr-4">{game.name}</span>
              <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatMinutes(game.minutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  let data;
  let loadError: string | null = null;

  try {
    data = await getSteamDashboardData();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Erreur inconnue";
  }

  if (loadError || !data) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-2xl font-semibold">Pocrastinados</h1>
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">Impossible de charger les données Steam.</p>
          <p className="mt-2">{loadError}</p>
          <p className="mt-4 text-red-700 dark:text-red-300">
            Vérifie que <code>SUPABASE_URL</code> et{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> sont configurées, que le
            schéma <code>supabase/schema.sql</code> a été appliqué, et
            qu&apos;au moins un fetch Steam (<code>npm run fetch:steam</code>)
            a été exécuté.
          </p>
        </div>
      </main>
    );
  }

  const monthLabel = new Date(data.thisMonth.periodStart).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">Pocrastinados</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Stats Steam — MVP
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Temps de jeu total (all-time)"
          value={formatMinutes(data.allTime.totalMinutes)}
        />
        <StatCard
          label={`Ce mois-ci (${monthLabel})`}
          value={formatMinutes(data.thisMonth.totalMinutes)}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4">
        <GameTable title="Répartition par jeu — ce mois-ci" games={data.thisMonth.games} />
        <GameTable title="Répartition par jeu — all-time" games={data.allTime.games} />
      </div>
    </main>
  );
}
