import { notFound } from "next/navigation";
import Link from "next/link";
import { getShareByToken } from "@/lib/share";
import { toPlain } from "@/lib/serialize";
import { ShareFlightView } from "@/components/share/share-flight-view";
import { displayFlightNumber } from "@/lib/utils";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = await getShareByToken(token);
  if (!payload) notFound();
  const title =
    payload.kind === "trip"
      ? payload.tripName ?? "Trip"
      : displayFlightNumber(payload.flight.flightNumber);

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">FlightBuddy</p>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {payload.ownerName && (
            <p className="text-sm text-muted-foreground">{payload.ownerName}</p>
          )}
        </div>
        <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">
          Login
        </Link>
      </div>
      <ShareFlightView payload={toPlain(payload)} />
    </main>
  );
}
