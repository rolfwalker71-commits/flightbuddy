import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { FlightDetailView } from "@/components/flights/flight-detail-view";
import { loadLiveUserFlight } from "@/lib/polling";
import { getUserFlights } from "@/lib/flights";
import { listUserTrips } from "@/lib/trips";
import { toPlain } from "@/lib/serialize";

export default async function FlightDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user.id;
  const [row, trips, allFlights] = await Promise.all([
    loadLiveUserFlight(userId, id),
    listUserTrips(userId),
    getUserFlights(userId),
  ]);
  if (!row) notFound();
  return (
    <FlightDetailView
      row={toPlain(row)}
      trips={toPlain(trips)}
      allFlights={toPlain(allFlights)}
    />
  );
}
