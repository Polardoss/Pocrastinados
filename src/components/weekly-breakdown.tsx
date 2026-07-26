import type { WeeklyCategoryBreakdown } from "@/lib/dashboard-data";
import { formatMinutes } from "@/lib/format";

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function WeeklyBreakdown({ weeks }: { weeks: WeeklyCategoryBreakdown[] }) {
  if (weeks.length === 0) {
    return <p className="text-sm text-ink-muted">Pas encore de données.</p>;
  }

  const maxTotal = Math.max(
    1,
    ...weeks.map((week) => week.steamMinutes + week.traktMinutes + week.youtubeMinutes)
  );

  return (
    <div>
      <div className="flex h-32 items-end gap-2.5 pt-2 sm:gap-3">
        {weeks.map((week) => {
          const total = week.steamMinutes + week.traktMinutes + week.youtubeMinutes;
          const heightPct = (total / maxTotal) * 100;
          return (
            <div key={week.weekStart} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="font-mono text-[10px] text-ink-faint">{formatMinutes(total)}</span>
              <div
                className="flex w-full max-w-7 flex-col-reverse overflow-hidden rounded-[4px]"
                style={{ height: `${heightPct}%` }}
                title={`Semaine du ${weekLabel(week.weekStart)} — ${formatMinutes(total)}`}
              >
                {week.youtubeMinutes > 0 && (
                  <div style={{ height: `${(week.youtubeMinutes / total) * 100}%`, background: "var(--youtube)" }} />
                )}
                {week.traktMinutes > 0 && (
                  <div style={{ height: `${(week.traktMinutes / total) * 100}%`, background: "var(--trakt)" }} />
                )}
                {week.steamMinutes > 0 && (
                  <div style={{ height: `${(week.steamMinutes / total) * 100}%`, background: "var(--steam)" }} />
                )}
              </div>
              <span className="text-[10px] text-ink-faint">{weekLabel(week.weekStart).split(" ")[0]}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--steam)" }} /> Steam
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--trakt)" }} /> Trakt
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--youtube)" }} /> YouTube
        </span>
      </div>
    </div>
  );
}
