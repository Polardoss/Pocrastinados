import Link from "next/link";
import { getMonthlyWrapped, shiftMonthKey } from "@/lib/dashboard-data";
import { formatMinutes } from "@/lib/format";

export const dynamic = "force-dynamic";

function RecapCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-black/[.08] p-5 text-left dark:border-white/[.145]">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{detail}</p>
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
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="flex items-center justify-between text-sm">
        <Link href={`/wrapped/${prevMonth}`} className="text-zinc-500 hover:underline">
          ← Mois précédent
        </Link>
        <Link href="/dashboard" className="text-zinc-500 hover:underline">
          Dashboard
        </Link>
        <Link href={`/wrapped/${nextMonth}`} className="text-zinc-500 hover:underline">
          Mois suivant →
        </Link>
      </div>

      {error || !data ? (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">Impossible de générer le récap.</p>
          <p className="mt-2">{error}</p>
        </div>
      ) : (
        <div className="mt-8 text-center">
          <p className="text-sm uppercase tracking-widest text-zinc-500">Ton Wrapped</p>
          <h1 className="mt-2 text-3xl font-bold capitalize">{data.monthLabel}</h1>

          <p className="mt-6 text-5xl font-black tracking-tight">
            {formatMinutes(data.totalMinutes)}
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            de divertissement au total ce mois-ci
          </p>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <RecapCard
              label="Jeu #1 (Steam)"
              value={data.steam.topGame?.label ?? "—"}
              detail={`${formatMinutes(data.steam.totalMinutes)} au total`}
            />
            <RecapCard
              label="Série/film #1 (Trakt)"
              value={data.trakt.topItem?.label ?? "—"}
              detail={`${data.trakt.movieCount} film(s), ${data.trakt.episodeCount} épisode(s)`}
            />
            <RecapCard
              label="Chaîne #1 (YouTube)"
              value={data.youtube.topChannel?.label ?? "—"}
              detail={`${data.youtube.videoCount} vidéo(s)`}
            />
          </div>
        </div>
      )}
    </main>
  );
}
