-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN "objectAlerts" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "TrackedAircraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "icao24" TEXT NOT NULL,
    "callsign" TEXT NOT NULL,
    "operator" TEXT,
    "airlineIata" TEXT,
    "lastOnGround" BOOLEAN,
    "lastSeenAt" TIMESTAMP(3),
    "lastAirborneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedAircraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedAircraft_userId_icao24_key" ON "TrackedAircraft"("userId", "icao24");

-- CreateIndex
CREATE INDEX "TrackedAircraft_userId_idx" ON "TrackedAircraft"("userId");

-- CreateIndex
CREATE INDEX "TrackedAircraft_icao24_idx" ON "TrackedAircraft"("icao24");

-- AddForeignKey
ALTER TABLE "TrackedAircraft" ADD CONSTRAINT "TrackedAircraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
