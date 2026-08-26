import { auth } from "@/auth";
import { getUserFlights } from "@/lib/flights";
import { LiveMapView } from "@/components/map/live-map-view";
import { toPlain } from "@/lib/serialize";

export default async function MapPage() {
  const session = await auth();
  const flights = await getUserFlights(session!.user.id);
  return <LiveMapView flights={toPlain(flights)} />;
}
