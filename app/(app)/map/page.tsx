import { auth } from "@/auth";
import { getUserFlights } from "@/lib/flights";
import { listTrackedAircraft } from "@/lib/tracked-aircraft";
import { LiveMapView } from "@/components/map/live-map-view";
import { toPlain } from "@/lib/serialize";

export default async function MapPage() {
  const session = await auth();
  const userId = session!.user.id;
  const [flights, tracked] = await Promise.all([getUserFlights(userId), listTrackedAircraft(userId)]);
  return <LiveMapView flights={toPlain(flights)} tracked={toPlain(tracked)} />;
}
