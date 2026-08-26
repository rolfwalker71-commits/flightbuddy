-- AlterTable
ALTER TABLE "UserFlight" ADD COLUMN "trackDaily" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "UserFlight_trackDaily_idx" ON "UserFlight"("trackDaily");
