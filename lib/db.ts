import { Prisma, PrismaClient } from "@prisma/client";

/** Detects a newly generated client so Turbopack can drop a stale globalThis singleton. */
const schemaStamp = Prisma.dmmf.datamodel.models
  .map((m) => `${m.name}:${m.fields.map((f) => f.name).join(",")}`)
  .join("|");

type PrismaGlobal = {
  prisma?: PrismaClient;
  prismaSchemaStamp?: string;
};

const globalForPrisma = globalThis as unknown as PrismaGlobal;

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.prisma &&
  globalForPrisma.prismaSchemaStamp !== schemaStamp
) {
  void globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaStamp = schemaStamp;
}

type RuntimeClient = {
  _runtimeDataModel?: {
    models?: Record<string, { fields?: Array<{ name: string }> | Record<string, unknown> }>;
  };
};

/** Fields the *live* PrismaClient instance knows — may be older than the generated types. */
export function clientModelFieldNames(model: string): Set<string> | null {
  const models = (prisma as unknown as RuntimeClient)._runtimeDataModel?.models;
  if (!models) return null;
  const entry = models[model] ?? models[model.toLowerCase()];
  const fields = entry?.fields;
  if (!fields) return null;
  if (Array.isArray(fields)) return new Set(fields.map((f) => f.name));
  return new Set(Object.keys(fields));
}

export function pickKnownModelData<T extends Record<string, unknown>>(model: string, data: T): Partial<T> {
  const known = clientModelFieldNames(model);
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (known && !known.has(key)) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function unknownArgNames(err: unknown): string[] {
  if (!(err instanceof Prisma.PrismaClientValidationError)) return [];
  return [...err.message.matchAll(/Unknown argument `([^`]+)`/g)].map((m) => m[1]);
}

export function isPrismaUnknownArgError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientValidationError)) return false;
  return unknownArgNames(err).length > 0 || /Unknown arg/i.test(err.message);
}

/** Write only fields this PrismaClient accepts so a stale singleton cannot crash the page. */
export async function safeUserFlightUpdate(
  id: string,
  data: Prisma.UserFlightUncheckedUpdateInput,
): Promise<void> {
  const patch = pickKnownModelData("UserFlight", data as Record<string, unknown>) as Prisma.UserFlightUncheckedUpdateInput;
  if (!Object.keys(patch).length) return;

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await prisma.userFlight.update({ where: { id }, data: patch });
      return;
    } catch (err) {
      const unknown = unknownArgNames(err);
      if (!unknown.length) {
        if (isPrismaUnknownArgError(err)) return;
        throw err;
      }
      for (const key of unknown) delete (patch as Record<string, unknown>)[key];
      if (!Object.keys(patch).length) return;
    }
  }
}

/**
 * Persist `trackDaily` even when a stale Prisma singleton drops the field
 * from typed updates (`pickKnownModelData` / unknown-arg retries).
 */
export async function persistUserFlightTrackDaily(ids: string[], trackDaily: boolean): Promise<void> {
  if (!ids.length) return;
  for (const id of ids) {
    await safeUserFlightUpdate(id, { trackDaily });
    await prisma.$executeRaw`UPDATE "UserFlight" SET "trackDaily" = ${trackDaily} WHERE "id" = ${id}`;
  }
}

export async function hydrateTrackDaily<T extends { id: string; trackDaily?: boolean }>(rows: T[]): Promise<T[]> {
  const missing = rows.filter((row) => typeof row.trackDaily !== "boolean");
  if (!missing.length) return rows;
  const flags = new Map<string, boolean>();
  for (const row of missing) {
    const found = await prisma.$queryRaw<Array<{ trackDaily: boolean }>>`
      SELECT "trackDaily" FROM "UserFlight" WHERE "id" = ${row.id}
    `;
    if (found[0]) flags.set(row.id, found[0].trackDaily);
  }
  return rows.map((row) =>
    typeof row.trackDaily === "boolean" ? row : { ...row, trackDaily: flags.get(row.id) ?? false },
  );
}

/** Write only fields this PrismaClient accepts so a stale singleton cannot crash the page. */
export async function safeFlightUpdate(flightId: string, data: Prisma.FlightUncheckedUpdateInput): Promise<void> {
  const patch = pickKnownModelData("Flight", data as Record<string, unknown>) as Prisma.FlightUncheckedUpdateInput;
  if (!Object.keys(patch).length) return;

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await prisma.flight.update({ where: { id: flightId }, data: patch });
      return;
    } catch (err) {
      const unknown = unknownArgNames(err);
      if (!unknown.length) {
        if (isPrismaUnknownArgError(err)) return;
        throw err;
      }
      for (const key of unknown) delete (patch as Record<string, unknown>)[key];
      if (!Object.keys(patch).length) return;
    }
  }
}
