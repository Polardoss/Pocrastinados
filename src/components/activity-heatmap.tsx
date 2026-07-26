import type { HeatmapDay } from "@/lib/dashboard-data";
import { formatMinutes } from "@/lib/format";

const LEVEL_COLORS = [
  "bg-zinc-100 dark:bg-zinc-800",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-300 dark:bg-emerald-700",
  "bg-emerald-500 dark:bg-emerald-600",
  "bg-emerald-700 dark:bg-emerald-400",
];

function levelFor(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

// Groups the (chronological) day list into GitHub-style weekly columns,
// padding the front so the grid always starts on a Monday.
function toWeeks(days: HeatmapDay[]): (HeatmapDay | null)[][] {
  if (days.length === 0) return [];

  const firstWeekday = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const padded: (HeatmapDay | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...days,
  ];

  const weeks: (HeatmapDay | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }
  return weeks;
}

export function ActivityHeatmap({ days }: { days: HeatmapDay[] }) {
  const weeks = toWeeks(days);

  if (weeks.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Pas encore de données.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex gap-1">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="flex flex-col gap-1">
            {week.map((day, dayIndex) =>
              day ? (
                <div
                  key={dayIndex}
                  title={`${day.date} — ${formatMinutes(day.minutes)}`}
                  className={`h-3 w-3 rounded-sm ${LEVEL_COLORS[levelFor(day.minutes)]}`}
                />
              ) : (
                <div key={dayIndex} className="h-3 w-3" />
              )
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>Moins</span>
        {LEVEL_COLORS.map((color, level) => (
          <div key={level} className={`h-3 w-3 rounded-sm ${color}`} />
        ))}
        <span>Plus</span>
      </div>
    </div>
  );
}
