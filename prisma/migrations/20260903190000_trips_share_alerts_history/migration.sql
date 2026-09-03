-- Trips / legs
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripLeg" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userFlightId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TripLeg_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripLeg_userFlightId_key" ON "TripLeg"("userFlightId");
CREATE INDEX "Trip_userId_idx" ON "Trip"("userId");
CREATE INDEX "TripLeg_tripId_sortOrder_idx" ON "TripLeg"("tripId", "sortOrder");

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripLeg" ADD CONSTRAINT "TripLeg_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripLeg" ADD CONSTRAINT "TripLeg_userFlightId_fkey" FOREIGN KEY ("userFlightId") REFERENCES "UserFlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Share links
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flightId" TEXT,
    "tripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");
CREATE INDEX "ShareLink_userId_idx" ON "ShareLink"("userId");
CREATE INDEX "ShareLink_flightId_idx" ON "ShareLink"("flightId");

ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Object history
CREATE TABLE "TrackedAircraftEvent" (
    "id" TEXT NOT NULL,
    "trackedAircraftId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "callsign" TEXT,
    "altitudeFt" DOUBLE PRECISION,
    "velocityKts" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedAircraftEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrackedAircraftEvent_trackedAircraftId_recordedAt_idx" ON "TrackedAircraftEvent"("trackedAircraftId", "recordedAt");

ALTER TABLE "TrackedAircraftEvent" ADD CONSTRAINT "TrackedAircraftEvent_trackedAircraftId_fkey" FOREIGN KEY ("trackedAircraftId") REFERENCES "TrackedAircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Richer alert prefs
ALTER TABLE "NotificationPreference" ADD COLUMN "gateClose" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NotificationPreference" ADD COLUMN "arrivalSoon" BOOLEAN NOT NULL DEFAULT true;
