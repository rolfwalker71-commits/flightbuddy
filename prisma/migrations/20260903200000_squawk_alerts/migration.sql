-- Squawk monitoring
ALTER TABLE "Flight" ADD COLUMN IF NOT EXISTS "lastSquawk" TEXT;
ALTER TABLE "TrackedAircraft" ADD COLUMN IF NOT EXISTS "lastSquawk" TEXT;
ALTER TABLE "NotificationPreference" ADD COLUMN IF NOT EXISTS "squawkAlerts" BOOLEAN NOT NULL DEFAULT true;
