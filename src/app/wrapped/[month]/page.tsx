import Link from "next/link";
import { getMonthlyWrapped, shiftMonthKey } from "@/lib/dashboard-data";
import { formatMinutes } from "@/lib/format";

export const dynamic = "force-dynamic";

const SOURCE_COLOR: Record<"steam" | "trakt" | "youtube", string> = {
  steam: "var(--steam)",
  trakt: "var(--trakt)",
  youtube: "var(--youtube)",
};

function RecapCard({
  source,
  label,
  value,
  detail,
}: {
  source: "steam" | "trakt" | "youtube";
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 text-left">
      <p
        className="arcade-display text-[10px] tracking-[0.14em]"
        style={{ color: SOURCE_COLOR[source] }}
      >
        {label}
      </p>
      <p className="mt-2 truncate text-base font-semibold">{value}</p>
      <p className="mt-1 text-sm text-ink-muted">{detail}</p>
    </div>
  );
}

export default async function WrappedPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const { month } = await params;

  let data;
  let error: string | null = null;
  try {
    data = await getMonthlyWrapped(month);
  } catch (e) {
    error = e instanceof Error ? e.message : "Erreur inconnue";
  }

  const prevMonth = shiftMonthKey(month, -1);
  const nextMonth = shiftMonthKey(month, 1);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-14 sm:px-6">
      <div className="arcade-display flex items-center justify-between text-[11px] tracking-wide">
        <Link href={`/wrapped/${prevMonth}`} className="text-ink-muted transition-colors hover:text-foreground">
          ← Précédent
        </Link>
        <Link href="/dashboard" className="text-pop transition-colors hover:text-foreground">
          Dashboard
        </Link>
        <Link href={`/wrapped/${nextMonth}`} className="text-ink-muted transition-colors hover:text-foreground">
          Suivant →
        </Link>
      </div>

      {error || !data ? (
        <div className="mt-8 rounded-xl border border-pop/30 bg-pop/10 p-6 text-sm text-ink-muted">
          <p className="font-medium text-foreground">Impossible de générer le récap.</p>
          <p className="mt-2">{error}</p>
        </div>
      ) : (
        <div
          className="mt-6 rounded-2xl border border-line bg-gradient-to-b from-surface-2 to-surface p-8 text-center sm:p-10"
          style={{
            boxShadow:
              "0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent), 0 24px 60px -30px color-mix(in srgb, var(--pop) 40%, transparent)",
          }}
        >
          <p className="arcade-display text-[11px] tracking-[0.3em] text-pop">High Score</p>
          <h1 className="arcade-display mt-2 text-2xl capitalize">{data.monthLabel}</h1>

          <p className="arcade-glow arcade-display mt-6 font-mono text-5xl text-accent sm:text-6xl">
            {formatMinutes(data.totalMinutes).toUpperCase()}
          </p>
          <p className="mt-2 text-sm text-ink-muted">de divertissement au total ce mois-ci</p>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <RecapCard
              source="steam"
              label="Jeu #1 — Steam"
              value={data.steam.topGame?.label ?? "—"}
              detail={
                data.steam.topGame
                  ? `${formatMinutes(data.steam.topGame.minutes)} joués — ${formatMinutes(data.steam.totalMinutes)} au total ce mois`
                  : "Pas encore de données"
              }
            />
            <RecapCard
              source="trakt"
              label="Série/film #1 — Trakt"
              value={data.trakt.topItem?.label ?? "—"}
              detail={`${data.trakt.movieCount} film(s), ${data.trakt.episodeCount} épisode(s)`}
            />
            <RecapCard
              source="youtube"
              label="Vidéo #1 — YouTube"
              value={data.youtube.topVideo?.label ?? "—"}
              detail={
                data.youtube.topVideo?.sublabel
                  ? `${data.youtube.topVideo.sublabel} · ${data.youtube.videoCount} vidéo(s) au total`
                  : `${data.youtube.videoCount} vidéo(s) au total`
              }
            />
          </div>
        </div>
      )}
    </main>
  );
}
