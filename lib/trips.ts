import { prisma } from "./db";
import { connectionBetween, type TripView } from "./trips-shared";

export type {
  ConnectionInfo,
  ConnectionLevel,
  TripView,
} from "./trips-shared";
export {
  connectionBetween,
  connectionByFlightId,
  suggestConnections,
  tripIdByFlightId,
} from "./trips-shared";

function tripNameFromLegs(
  legs: Array<{
    flight: {
      departureAirport?: { iata?: string | null } | null;
      arrivalAirport?: { iata?: string | null } | null;
    };
  }>,
) {
  const first = legs[0]?.flight.departureAirport?.iata;
  const last = legs[legs.length - 1]?.flight.arrivalAirport?.iata;
  if (first && last) return `${first} → ${last}`;
  return null;
}

export async function listUserTrips(userId: string): Promise<TripView[]> {
  const trips = await prisma.trip.findMany({
    where: { userId },
    include: {
      legs: {
        orderBy: { sortOrder: "asc" },
        include: {
          userFlight: {
            include: { flight: { include: { departureAirport: true, arrivalAirport: true } } },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return trips.map((trip) => {
    const legs = trip.legs.map((leg, index) => {
      const next = trip.legs[index + 1];
      const flight = leg.userFlight.flight;
      const nextFlight = next?.userFlight.flight;
      const arrive = flight.actualArr ?? flight.estimatedArr ?? flight.scheduledArr;
      const depart = nextFlight
        ? (nextFlight.actualDep ?? nextFlight.estimatedDep ?? nextFlight.scheduledDep)
        : null;
      return {
        id: leg.id,
        sortOrder: leg.sortOrder,
        userFlightId: leg.userFlightId,
        flightId: flight.id,
        connectionToNext: next
          ? connectionBetween(
              arrive,
              depart,
              flight.arrivalAirport?.iata,
              nextFlight?.departureAirport?.iata,
            )
          : null,
      };
    });
    return {
      id: trip.id,
      name: trip.name ?? tripNameFromLegs(trip.legs.map((l) => l.userFlight)),
      createdAt: trip.createdAt,
      legs,
    };
  });
}

export async function createTrip(opts: {
  userId: string;
  name?: string | null;
  userFlightIds: string[];
}) {
  const ids = [...new Set(opts.userFlightIds)];
  if (ids.length < 2) throw new Error("A trip needs at least two flights");

  const rows = await prisma.userFlight.findMany({
    where: { userId: opts.userId, id: { in: ids } },
    include: { flight: true, tripLeg: true },
  });
  if (rows.length !== ids.length) throw new Error("Flight not found");
  if (rows.some((r) => r.tripLeg)) throw new Error("Flight already in a trip");

  const ordered = [...rows].sort(
    (a, b) => a.flight.scheduledDep.getTime() - b.flight.scheduledDep.getTime(),
  );

  const trip = await prisma.trip.create({
    data: {
      userId: opts.userId,
      name: opts.name ?? null,
      legs: {
        create: ordered.map((row, index) => ({
          userFlightId: row.id,
          sortOrder: index,
        })),
      },
    },
  });
  return trip;
}

export async function addFlightToTrip(opts: {
  userId: string;
  tripId: string;
  userFlightId: string;
}) {
  const trip = await prisma.trip.findFirst({
    where: { id: opts.tripId, userId: opts.userId },
    include: { legs: true },
  });
  if (!trip) return null;

  const row = await prisma.userFlight.findFirst({
    where: { id: opts.userFlightId, userId: opts.userId },
    include: { tripLeg: true, flight: true },
  });
  if (!row || row.tripLeg) return null;

  const maxOrder = trip.legs.reduce((m, l) => Math.max(m, l.sortOrder), -1);
  await prisma.tripLeg.create({
    data: {
      tripId: trip.id,
      userFlightId: row.id,
      sortOrder: maxOrder + 1,
    },
  });

  // Re-sort by departure
  const legs = await prisma.tripLeg.findMany({
    where: { tripId: trip.id },
    include: { userFlight: { include: { flight: true } } },
  });
  const ordered = [...legs].sort(
    (a, b) =>
      a.userFlight.flight.scheduledDep.getTime() - b.userFlight.flight.scheduledDep.getTime(),
  );
  await prisma.$transaction(
    ordered.map((leg, index) =>
      prisma.tripLeg.update({ where: { id: leg.id }, data: { sortOrder: index } }),
    ),
  );
  return trip;
}

export async function createTripFromFlightIds(opts: {
  userId: string;
  flightIds: string[];
  name?: string | null;
}) {
  const rows = await prisma.userFlight.findMany({
    where: { userId: opts.userId, flightId: { in: opts.flightIds } },
    select: { id: true },
  });
  return createTrip({
    userId: opts.userId,
    name: opts.name,
    userFlightIds: rows.map((r) => r.id),
  });
}

export async function removeTrip(userId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId } });
  if (!trip) return null;
  await prisma.trip.delete({ where: { id: trip.id } });
  return trip;
}

export async function removeLegFromTrip(userId: string, tripId: string, userFlightId: string) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: { legs: true },
  });
  if (!trip) return null;
  const leg = trip.legs.find((l) => l.userFlightId === userFlightId);
  if (!leg) return null;
  await prisma.tripLeg.delete({ where: { id: leg.id } });
  const remaining = trip.legs.filter((l) => l.id !== leg.id);
  if (remaining.length < 2) {
    await prisma.trip.delete({ where: { id: trip.id } });
    return { deletedTrip: true };
  }
  return { deletedTrip: false };
}
