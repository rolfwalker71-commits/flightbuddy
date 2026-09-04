-- AlterTable
ALTER TABLE "UserFlight" ADD COLUMN "inLogbook" BOOLEAN NOT NULL DEFAULT true;

-- Daily-tracked flights should not inflate the logbook.
UPDATE "UserFlight" SET "inLogbook" = false WHERE "trackDaily" = true;

-- CreateIndex
CREATE INDEX "UserFlight_userId_inLogbook_idx" ON "UserFlight"("userId", "inLogbook");
