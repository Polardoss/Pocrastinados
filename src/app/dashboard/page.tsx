import Link from "next/link";
import {
  getActivityHeatmap,
  getSteamDashboardData,
  getTraktDashboardData,
  getWeeklyCategoryBreakdown,
  getYoutubeDashboardData,
  type BreakdownItem,
} from "@/lib/dashboard-data";
import { formatMinutes } from "@/lib/format";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { WeeklyBreakdown } from "@/components/weekly-breakdown";

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

interface SourceSectionData {
  totalMinutesAllTime: number;
  totalMinutesMonth: number;
  allTimeItems: BreakdownItem[];
  monthItems: BreakdownItem[];
}

function SourceSection({
  title,
  breakdownLabel,
  monthLabel,
  result,
}: {
  title: string;
  breakdownLabel: string;
  monthLabel: string;
  result: PromiseSettledResult<SourceSectionData>;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      {result.status === "rejected" ? (
        <div className="mt-4">
          <ErrorCard
            title={`Impossible de charger les données ${title}.`}
            message={errorMessage(result.reason)}
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Temps total (all-time)"
              value={formatMinutes(result.value.totalMinutesAllTime)}
            />
            <StatCard
              label={`Ce mois-ci (${monthLabel})`}
              value={formatMinutes(result.value.totalMinutesMonth)}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4">
            <BreakdownList
              title={`${breakdownLabel} — ce mois-ci`}
              items={result.value.monthItems}
            />
            <BreakdownList
              title={`${breakdownLabel} — all-time`}
              items={result.value.allTimeItems}
            />
          </div>
        </>
      )}
    </section>
  );
}

export default async function DashboardPage() {
  const [steamResult, traktResult, youtubeResult, heatmapResult, weeklyResult] =
    await Promise.allSettled([
      getSteamDashboardData(),
      getTraktDashboardData(),
      getYoutubeDashboardData(),
      getActivityHeatmap(),
      getWeeklyCategoryBreakdown(),
    ]);

  const steamData: PromiseSettledResult<SourceSectionData> =
    steamResult.status === "fulfilled"
      ? {
          status: "fulfilled",
          value: {
            totalMinutesAllTime: steamResult.value.allTime.totalMinutes,
            totalMinutesMonth: steamResult.value.thisMonth.totalMinutes,
            allTimeItems: steamResult.value.allTime.games,
            monthItems: steamResult.value.thisMonth.games,
          },
        }
      : steamResult;

  const traktData: PromiseSettledResult<SourceSectionData> =
    traktResult.status === "fulfilled"
      ? {
          status: "fulfilled",
          value: {
            totalMinutesAllTime: traktResult.value.allTime.totalMinutes,
            totalMinutesMonth: traktResult.value.thisMonth.totalMinutes,
            allTimeItems: traktResult.value.allTime.items,
            monthItems: traktResult.value.thisMonth.items,
          },
        }
      : traktResult;

  const youtubeData: PromiseSettledResult<SourceSectionData> =
    youtubeResult.status === "fulfilled"
      ? {
          status: "fulfilled",
          value: {
            totalMinutesAllTime: youtubeResult.value.allTime.totalMinutes,
            totalMinutesMonth: youtubeResult.value.thisMonth.totalMinutes,
            allTimeItems: youtubeResult.value.allTime.items,
            monthItems: youtubeResult.value.thisMonth.items,
          },
        }
      : youtubeResult;

  const monthLabel = new Date().toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pocrastinados</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Stats de divertissement
          </p>
        </div>
        <Link
          href="/wrapped"
          className="shrink-0 rounded-full border border-black/[.08] px-4 py-2 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
        >
          Récap du mois →
        </Link>
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Activité globale</h2>
        <div className="mt-4 rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-[#111]">
          {heatmapResult.status === "rejected" ? (
            <ErrorCard
              title="Impossible de charger la heatmap d'activité."
              message={errorMessage(heatmapResult.reason)}
            />
          ) : (
            <ActivityHeatmap days={heatmapResult.value} />
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Répartition hebdomadaire</h2>
        <div className="mt-4 rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-[#111]">
          {weeklyResult.status === "rejected" ? (
            <ErrorCard
              title="Impossible de charger la répartition hebdomadaire."
              message={errorMessage(weeklyResult.reason)}
            />
          ) : (
            <WeeklyBreakdown weeks={weeklyResult.value} />
          )}
        </div>
      </section>

      <SourceSection
        title="Jeux vidéo (Steam)"
        breakdownLabel="Répartition par jeu"
        monthLabel={monthLabel}
        result={steamData}
      />
      <SourceSection
        title="Séries & films (Trakt)"
        breakdownLabel="Répartition par série/film"
        monthLabel={monthLabel}
        result={traktData}
      />
      <SourceSection
        title="YouTube"
        breakdownLabel="Répartition par chaîne"
        monthLabel={monthLabel}
        result={youtubeData}
      />
    </main>
  );
}
