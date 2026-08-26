-- PostGIS is optional (lat/lon are stored as floats). Enable it when the
-- extension is installed, e.g. in the production PostGIS image.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'postgis not available, continuing without it';
END
$$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "FlightStatus" AS ENUM ('SCHEDULED', 'DELAYED', 'BOARDING', 'DEPARTED', 'EN_ROUTE', 'LANDED', 'CANCELLED', 'DIVERTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PollPhase" AS ENUM ('INACTIVE', 'PREFLIGHT', 'AIRBORNE', 'COMPLETE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Airport" (
    "id" TEXT NOT NULL,
    "icao" TEXT,
    "iata" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ourairports',

    CONSTRAINT "Airport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Airline" (
    "id" TEXT NOT NULL,
    "icao" TEXT,
    "iata" TEXT,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "callsign" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'openflights',

    CONSTRAINT "Airline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "airlineIata" TEXT,
    "airlineIcao" TEXT,
    "fromIata" TEXT NOT NULL,
    "toIata" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'openflights',

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flight" (
    "id" TEXT NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "airlineIata" TEXT,
    "airlineIcao" TEXT,
    "airlineId" TEXT,
    "departureAirportId" TEXT,
    "arrivalAirportId" TEXT,
    "scheduledDep" TIMESTAMP(3) NOT NULL,
    "scheduledArr" TIMESTAMP(3),
    "estimatedDep" TIMESTAMP(3),
    "estimatedArr" TIMESTAMP(3),
    "actualDep" TIMESTAMP(3),
    "actualArr" TIMESTAMP(3),
    "status" "FlightStatus" NOT NULL DEFAULT 'SCHEDULED',
    "delayMinutes" INTEGER,
    "gate" TEXT,
    "terminal" TEXT,
    "aircraftType" TEXT,
    "icao24" TEXT,
    "callsign" TEXT,
    "lastLat" DOUBLE PRECISION,
    "lastLon" DOUBLE PRECISION,
    "lastAltitudeFt" DOUBLE PRECISION,
    "lastVelocityKts" DOUBLE PRECISION,
    "lastHeading" DOUBLE PRECISION,
    "lastOnGround" BOOLEAN,
    "lastPositionAt" TIMESTAMP(3),
    "pollPhase" "PollPhase" NOT NULL DEFAULT 'INACTIVE',
    "nextPollAt" TIMESTAMP(3),
    "lastStatusSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFlight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "seat" TEXT,
    "notes" TEXT,
    "pushAlerts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightPosition" (
    "id" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "altitudeFt" DOUBLE PRECISION,
    "velocityKts" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "onGround" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'opensky',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "webPush" BOOLEAN NOT NULL DEFAULT true,
    "gateChanges" BOOLEAN NOT NULL DEFAULT true,
    "delaysStatus" BOOLEAN NOT NULL DEFAULT true,
    "preflight2h" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "flightId" TEXT,
    "kind" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Airport_icao_key" ON "Airport"("icao");

-- CreateIndex
CREATE UNIQUE INDEX "Airport_iata_key" ON "Airport"("iata");

-- CreateIndex
CREATE INDEX "Airport_city_idx" ON "Airport"("city");

-- CreateIndex
CREATE INDEX "Airport_country_idx" ON "Airport"("country");

-- CreateIndex
CREATE UNIQUE INDEX "Airline_icao_key" ON "Airline"("icao");

-- CreateIndex
CREATE UNIQUE INDEX "Airline_iata_key" ON "Airline"("iata");

-- CreateIndex
CREATE INDEX "Route_airlineIata_fromIata_toIata_idx" ON "Route"("airlineIata", "fromIata", "toIata");

-- CreateIndex
CREATE INDEX "Route_fromIata_toIata_idx" ON "Route"("fromIata", "toIata");

-- CreateIndex
CREATE INDEX "Flight_nextPollAt_pollPhase_idx" ON "Flight"("nextPollAt", "pollPhase");

-- CreateIndex
CREATE INDEX "Flight_status_idx" ON "Flight"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Flight_flightNumber_scheduledDep_key" ON "Flight"("flightNumber", "scheduledDep");

-- CreateIndex
CREATE INDEX "UserFlight_userId_idx" ON "UserFlight"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFlight_userId_flightId_key" ON "UserFlight"("userId", "flightId");

-- CreateIndex
CREATE INDEX "FlightPosition_flightId_recordedAt_idx" ON "FlightPosition"("flightId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiLog_provider_createdAt_idx" ON "ApiLog"("provider", "createdAt");

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_departureAirportId_fkey" FOREIGN KEY ("departureAirportId") REFERENCES "Airport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_arrivalAirportId_fkey" FOREIGN KEY ("arrivalAirportId") REFERENCES "Airport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFlight" ADD CONSTRAINT "UserFlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFlight" ADD CONSTRAINT "UserFlight_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightPosition" ADD CONSTRAINT "FlightPosition_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

