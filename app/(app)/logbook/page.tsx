import { auth } from "@/auth";
import { getLogbookStats } from "@/lib/stats";
import { getRequestPrefs } from "@/lib/i18n/prefs";
import { LogbookView } from "@/components/flights/logbook-view";

export default async function LogbookPage() {
  const session = await auth();
  const prefs = await getRequestPrefs();
  const year = new Date().getFullYear();
  const [yearStats, allTimeStats] = await Promise.all([
    getLogbookStats(session!.user.id, year),
    getLogbookStats(session!.user.id),
  ]);

  return (
    <LogbookView
      year={year}
      yearStats={yearStats}
      allTimeStats={allTimeStats}
      locale={prefs.locale}
      units={prefs.units}
    />
  );
}
