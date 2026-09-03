import { prisma } from "./db";

export type SharedFlight = NonNullable<Awaited<ReturnType<typeof loadSharedFlight>>>;

export type SharePayload =
  | {
      kind: "flight";
      token: string;
      ownerName: string | null;
      flight: SharedFlight;
    }
  | {
      kind: "trip";
      token: string;
      ownerName: string | null;
      tripName: string | null;
      flights: SharedFlight[];
    };

async function loadSharedFlight(flightId: string) {
  return prisma.flight.findUnique({
    where: { id: flightId },
    include: {
      airline: true,
      departureAirport: true,
      arrivalAirport: true,
      positions: { orderBy: { recordedAt: "desc" }, take: 80 },
    },
  });
}

export async function createFlightShare(userId: string, flightId: string) {
  const owned = await prisma.userFlight.findFirst({ where: { userId, flightId } });
  if (!owned) return null;
  const existing = await prisma.shareLink.findFirst({
    where: { userId, flightId, tripId: null },
  });
  if (existing) return existing;
  return prisma.shareLink.create({
    data: { userId, flightId },
  });
}

export async function createTripShare(userId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId } });
  if (!trip) return null;
  const existing = await prisma.shareLink.findFirst({
    where: { userId, tripId },
  });
  if (existing) return existing;
  return prisma.shareLink.create({
    data: { userId, tripId },
  });
}

export async function revokeShare(userId: string, token: string) {
  const row = await prisma.shareLink.findFirst({ where: { userId, token } });
  if (!row) return null;
  await prisma.shareLink.delete({ where: { id: row.id } });
  return row;
}

export async function getShareByToken(token: string): Promise<SharePayload | null> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      user: { select: { name: true } },
      trip: {
        include: {
          legs: {
            orderBy: { sortOrder: "asc" },
            include: { userFlight: true },
          },
        },
      },
    },
  });
  if (!link) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;

  if (link.tripId && link.trip) {
    const flights = [];
    for (const leg of link.trip.legs) {
      const flight = await loadSharedFlight(leg.userFlight.flightId);
      if (flight) flights.push(flight);
    }
    return {
      kind: "trip",
      token: link.token,
      ownerName: link.user.name,
      tripName: link.trip.name,
      flights,
    };
  }

  if (!link.flightId) return null;
  const flight = await loadSharedFlight(link.flightId);
  if (!flight) return null;
  return {
    kind: "flight",
    token: link.token,
    ownerName: link.user.name,
    flight,
  };
}

export async function getFlightShareToken(userId: string, flightId: string) {
  const row = await prisma.shareLink.findFirst({
    where: { userId, flightId, tripId: null },
    select: { token: true },
  });
  return row?.token ?? null;
}
