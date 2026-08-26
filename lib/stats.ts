import { FlightStatus } from "@prisma/client";
import { prisma } from "./db";
import { haversineMiles } from "./geo";

export async function getLogbookStats(userId: string, year?: number) {
  const where = {
    userId,
    flight: {
      status: { in: [FlightStatus.LANDED, FlightStatus.EN_ROUTE, FlightStatus.DEPARTED] },
      ...(year
        ? {
            scheduledDep: {
              gte: new Date(`${year}-01-01T00:00:00.000Z`),
              lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
            },
          }
        : {}),
    },
  };

  const rows = await prisma.userFlight.findMany({
    where,
    include: {
      flight: {
        include: { departureAirport: true, arrivalAirport: true, airline: true },
      },
    },
  });

  const airports = new Map<string, { code: string; city: string | null; count: number }>();
  const airlines = new Map<string, { name: string; count: number }>();
  const countries = new Set<string>();
  let miles = 0;
  let minutes = 0;

  for (const row of rows) {
    const { flight } = row;
    const dep = flight.departureAirport;
    const arr = flight.arrivalAirport;
    if (dep?.iata) {
      const key = dep.iata;
      airports.set(key, {
        code: key,
        city: dep.city,
        count: (airports.get(key)?.count ?? 0) + 1,
      });
      if (dep.country) countries.add(dep.country);
    }
    if (arr?.iata) {
      const key = arr.iata;
      airports.set(key, {
        code: key,
        city: arr.city,
        count: (airports.get(key)?.count ?? 0) + 1,
      });
      if (arr.country) countries.add(arr.country);
    }
    if (flight.airline?.name) {
      airlines.set(flight.airline.name, {
        name: flight.airline.name,
        count: (airlines.get(flight.airline.name)?.count ?? 0) + 1,
      });
    }
    if (dep && arr) miles += haversineMiles(dep, arr);
    const start = flight.actualDep ?? flight.scheduledDep;
    const end = flight.actualArr ?? flight.scheduledArr;
    if (start && end) {
      minutes += Math.max(0, (end.getTime() - start.getTime()) / 60000);
    }
  }

  return {
    flights: rows.length,
    hours: minutes / 60,
    miles,
    countries: countries.size,
    topAirports: [...airports.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    topAirlines: [...airlines.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}
