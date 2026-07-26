import type { WeeklyCategoryBreakdown } from "@/lib/dashboard-data";
import { formatMinutes } from "@/lib/format";

const CATEGORY_COLORS = {
  steam: "bg-sky-500",
  trakt: "bg-purple-500",
  youtube: "bg-red-500",
};

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function WeeklyBreakdown({ weeks }: { weeks: WeeklyCategoryBreakdown[] }) {
  if (weeks.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Pas encore de données.</p>;
  }

  // Segments are sized relative to the busiest week so both the mix and the
  // relative total across weeks are visible at a glance.
  const maxTotal = Math.max(
    1,
    ...weeks.map((week) => week.steamMinutes + week.traktMinutes + week.youtubeMinutes)
  );

  return (
    <div>
      <div className="space-y-3">
        {weeks.map((week) => {
          const total = week.steamMinutes + week.traktMinutes + week.youtubeMinutes;
          return (
            <div key={week.weekStart}>
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Semaine du {weekLabel(week.weekStart)}</span>
                <span>{formatMinutes(total)}</span>
              </div>
              <div className="mt-1 flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                {week.steamMinutes > 0 && (
                  <div
                    className={CATEGORY_COLORS.steam}
                    style={{ width: `${(week.steamMinutes / maxTotal) * 100}%` }}
                  />
                )}
                {week.traktMinutes > 0 && (
                  <div
                    className={CATEGORY_COLORS.trakt}
                    style={{ width: `${(week.traktMinutes / maxTotal) * 100}%` }}
                  />
                )}
                {week.youtubeMinutes > 0 && (
                  <div
                    className={CATEGORY_COLORS.youtube}
                    style={{ width: `${(week.youtubeMinutes / maxTotal) * 100}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${CATEGORY_COLORS.steam}`} /> Steam
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${CATEGORY_COLORS.trakt}`} /> Trakt
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${CATEGORY_COLORS.youtube}`} /> YouTube
        </span>
      </div>
    </div>
  );
}
