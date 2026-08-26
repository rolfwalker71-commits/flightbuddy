import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { FlightDetailView } from "@/components/flights/flight-detail-view";
import { loadLiveUserFlight } from "@/lib/polling";
import { toPlain } from "@/lib/serialize";

export default async function FlightDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const row = await loadLiveUserFlight(session!.user.id, id);
  if (!row) notFound();
  return <FlightDetailView row={toPlain(row)} />;
}
