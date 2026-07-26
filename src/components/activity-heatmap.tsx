import type { HeatmapDay } from "@/lib/dashboard-data";
import { formatMinutes } from "@/lib/format";

function levelFor(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

const LEVEL_STYLE = [
  { background: "var(--surface-2)", boxShadow: "none" },
  { background: "color-mix(in srgb, var(--accent) 30%, var(--surface-2))", boxShadow: "none" },
  { background: "color-mix(in srgb, var(--accent) 55%, var(--surface-2))", boxShadow: "none" },
  { background: "color-mix(in srgb, var(--accent) 80%, var(--surface-2))", boxShadow: "0 0 6px color-mix(in srgb, var(--accent) 60%, transparent)" },
  { background: "var(--accent)", boxShadow: "0 0 10px color-mix(in srgb, var(--accent) 80%, transparent)" },
];

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
    return <p className="text-sm text-ink-muted">Pas encore de données.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex gap-[3px]">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="flex flex-col gap-[3px]">
            {week.map((day, dayIndex) =>
              day ? (
                <div
                  key={dayIndex}
                  title={`${day.date} — ${formatMinutes(day.minutes)}`}
                  className="h-2 w-2 rounded-[2px]"
                  style={LEVEL_STYLE[levelFor(day.minutes)]}
                />
              ) : (
                <div key={dayIndex} className="h-2 w-2" />
              )
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1 text-xs text-ink-muted">
        <span>Moins</span>
        {LEVEL_STYLE.map((style, level) => (
          <div key={level} className="h-2 w-2 rounded-[2px]" style={style} />
        ))}
        <span>Plus</span>
      </div>
    </div>
  );
}
