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

type SourceKey = "steam" | "trakt" | "youtube";

const SOURCE_LABEL: Record<SourceKey, string> = {
  steam: "Steam",
  trakt: "Trakt",
  youtube: "YouTube",
};

interface RankedEntry extends BreakdownItem {
  source: SourceKey;
}

function Board({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface p-5 sm:p-6 ${className}`}
    >
      <h2 className="arcade-display text-[11px] tracking-[0.16em] text-ink-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-pop/30 bg-pop/10 px-3 py-2 text-xs text-ink-muted">
      Erreur : {message}
    </p>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erreur inconnue";
}

function RankRow({ rank, entry }: { rank: number; entry: RankedEntry }) {
  const isTop = rank === 1;
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={`flex h-6 w-6 flex-none items-center justify-center rounded-md border font-mono text-xs font-bold ${
          isTop ? "border-accent bg-accent text-[#241a02]" : "border-line bg-surface-2 text-ink-muted"
        }`}
        style={isTop ? { boxShadow: "0 0 12px color-mix(in srgb, var(--accent) 55%, transparent)" } : undefined}
      >
        {rank}
      </span>
      <span className="mt-1 h-1.5 w-1.5 flex-none self-start rounded-full" style={{ background: `var(--${entry.source})` }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{entry.label}</p>
        {entry.sublabel && <p className="truncate text-[10px] text-ink-faint">{entry.sublabel}</p>}
      </div>
      <span className="flex-none font-mono text-xs text-ink-muted">{formatMinutes(entry.minutes)}</span>
    </div>
  );
}

function SourceBoard({
  source,
  result,
}: {
  source: SourceKey;
  result: PromiseSettledResult<{ totalMinutes: number; totalCount: number; topItems: BreakdownItem[] }>;
}) {
  return (
    <Board title={SOURCE_LABEL[source]}>
      {result.status === "rejected" ? (
        <ErrorNote message={errorMessage(result.reason)} />
      ) : (
        <>
          <p
            className="font-mono text-2xl font-semibold"
            style={{ color: `var(--${source})` }}
          >
            {formatMinutes(result.value.totalMinutes)}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">all-time · {result.value.totalCount} entrée(s)</p>
          <div className="mt-3 divide-y divide-line/60">
            {result.value.topItems.length === 0 ? (
              <p className="py-2 text-xs text-ink-muted">Pas encore de données.</p>
            ) : (
              result.value.topItems.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                  <div className="min-w-0">
                    <p className="truncate text-ink">{item.label}</p>
                    {item.sublabel && <p className="truncate text-[10px] text-ink-faint">{item.sublabel}</p>}
                  </div>
                  <span className="flex-none font-mono text-ink-muted">{formatMinutes(item.minutes)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Board>
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

  const monthLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const thisMonthTotal =
    (steamResult.status === "fulfilled" ? steamResult.value.thisMonth.totalMinutes : 0) +
    (traktResult.status === "fulfilled" ? traktResult.value.thisMonth.totalMinutes : 0) +
    (youtubeResult.status === "fulfilled" ? youtubeResult.value.thisMonth.totalMinutes : 0);

  const leaderboard: RankedEntry[] = [
    ...(steamResult.status === "fulfilled"
      ? steamResult.value.thisMonth.games.map((g) => ({ ...g, source: "steam" as const }))
      : []),
    ...(traktResult.status === "fulfilled"
      ? traktResult.value.thisMonth.items.map((i) => ({ ...i, source: "trakt" as const }))
      : []),
    ...(youtubeResult.status === "fulfilled"
      ? youtubeResult.value.thisMonth.items.map((i) => ({ ...i, source: "youtube" as const }))
      : []),
  ]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 6);

  const steamBoardResult: PromiseSettledResult<{ totalMinutes: number; totalCount: number; topItems: BreakdownItem[] }> =
    steamResult.status === "fulfilled"
      ? {
          status: "fulfilled",
          value: {
            totalMinutes: steamResult.value.allTime.totalMinutes,
            totalCount: steamResult.value.allTime.games.length,
            topItems: steamResult.value.allTime.games.slice(0, 6),
          },
        }
      : steamResult;

  const traktBoardResult: PromiseSettledResult<{ totalMinutes: number; totalCount: number; topItems: BreakdownItem[] }> =
    traktResult.status === "fulfilled"
      ? {
          status: "fulfilled",
          value: {
            totalMinutes: traktResult.value.allTime.totalMinutes,
            totalCount: traktResult.value.allTime.totalItems,
            topItems: traktResult.value.allTime.items.slice(0, 6),
          },
        }
      : traktResult;

  const youtubeBoardResult: PromiseSettledResult<{ totalMinutes: number; totalCount: number; topItems: BreakdownItem[] }> =
    youtubeResult.status === "fulfilled"
      ? {
          status: "fulfilled",
          value: {
            totalMinutes: youtubeResult.value.allTime.totalMinutes,
            totalCount: youtubeResult.value.allTime.totalVideos,
            topItems: youtubeResult.value.allTime.items.slice(0, 6),
          },
        }
      : youtubeResult;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-14 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="arcade-display text-lg">Pocrastinados</h1>
        <Link
          href="/wrapped"
          className="arcade-display flex-none rounded-full border border-pop/50 px-4 py-2 text-[11px] tracking-wide text-pop transition-colors hover:bg-pop/10"
        >
          Récap du mois →
        </Link>
      </div>

      <div
        className="mt-6 rounded-2xl border border-line bg-gradient-to-b from-surface-2 to-surface p-8 text-center"
        style={{ boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent), 0 24px 60px -30px color-mix(in srgb, var(--pop) 40%, transparent)" }}
      >
        <p className="arcade-display text-[11px] tracking-[0.3em] text-pop">High Score — {monthLabel}</p>
        <p className="arcade-glow arcade-display mt-2 font-mono text-5xl text-accent sm:text-6xl">
          {formatMinutes(thisMonthTotal).toUpperCase()}
        </p>
        <p className="mt-2 text-sm text-ink-muted">de divertissement cumulé ce mois-ci</p>
      </div>

      <Board title="🏆 Classement du mois" className="mt-6">
        {leaderboard.length === 0 ? (
          <p className="text-sm text-ink-muted">Pas encore de données ce mois-ci.</p>
        ) : (
          <div className="divide-y divide-line/60">
            {leaderboard.map((entry, i) => (
              <RankRow key={entry.key} rank={i + 1} entry={entry} />
            ))}
          </div>
        )}
      </Board>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SourceBoard source="steam" result={steamBoardResult} />
        <SourceBoard source="trakt" result={traktBoardResult} />
        <SourceBoard source="youtube" result={youtubeBoardResult} />
      </div>

      <Board title="Équaliseur hebdomadaire" className="mt-6">
        {weeklyResult.status === "rejected" ? (
          <ErrorNote message={errorMessage(weeklyResult.reason)} />
        ) : (
          <WeeklyBreakdown weeks={weeklyResult.value} />
        )}
      </Board>

      <Board title="Combo d'activité — 52 semaines" className="mt-6">
        {heatmapResult.status === "rejected" ? (
          <ErrorNote message={errorMessage(heatmapResult.reason)} />
        ) : (
          <ActivityHeatmap days={heatmapResult.value} />
        )}
      </Board>
    </main>
  );
}
