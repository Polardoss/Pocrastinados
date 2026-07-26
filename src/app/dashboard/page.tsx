import {
  getSteamDashboardData,
  getTraktDashboardData,
  type BreakdownItem,
} from "@/lib/dashboard-data";
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

function BreakdownList({ title, items }: { title: string; items: BreakdownItem[] }) {
  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-[#111]">
      <h3 className="text-lg font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Pas encore de données.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-black/[.06] dark:divide-white/[.08]">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between py-2 text-sm">
              <span className="truncate pr-4">{item.label}</span>
              <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatMinutes(item.minutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <p className="font-medium">{title}</p>
      <p className="mt-2">{message}</p>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erreur inconnue";
}

export default async function DashboardPage() {
  const [steamResult, traktResult] = await Promise.allSettled([
    getSteamDashboardData(),
    getTraktDashboardData(),
  ]);

  const monthLabel = new Date().toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">Pocrastinados</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Stats de divertissement
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Jeux vidéo (Steam)</h2>
        {steamResult.status === "rejected" ? (
          <div className="mt-4">
            <ErrorCard
              title="Impossible de charger les données Steam."
              message={errorMessage(steamResult.reason)}
            />
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StatCard
                label="Temps de jeu total (all-time)"
                value={formatMinutes(steamResult.value.allTime.totalMinutes)}
              />
              <StatCard
                label={`Ce mois-ci (${monthLabel})`}
                value={formatMinutes(steamResult.value.thisMonth.totalMinutes)}
              />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4">
              <BreakdownList
                title="Répartition par jeu — ce mois-ci"
                items={steamResult.value.thisMonth.games}
              />
              <BreakdownList
                title="Répartition par jeu — all-time"
                items={steamResult.value.allTime.games}
              />
            </div>
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Séries &amp; films (Trakt)</h2>
        {traktResult.status === "rejected" ? (
          <div className="mt-4">
            <ErrorCard
              title="Impossible de charger les données Trakt."
              message={errorMessage(traktResult.reason)}
            />
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StatCard
                label="Temps regardé total (all-time)"
                value={formatMinutes(traktResult.value.allTime.totalMinutes)}
              />
              <StatCard
                label={`Ce mois-ci (${monthLabel})`}
                value={formatMinutes(traktResult.value.thisMonth.totalMinutes)}
              />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4">
              <BreakdownList
                title="Répartition par série/film — ce mois-ci"
                items={traktResult.value.thisMonth.items}
              />
              <BreakdownList
                title="Répartition par série/film — all-time"
                items={traktResult.value.allTime.items}
              />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
