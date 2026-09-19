-- AlterTable
ALTER TABLE "User" ADD COLUMN "widgetOptions" JSONB;

-- CreateTable
CREATE TABLE "WidgetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WidgetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WidgetToken_userId_key" ON "WidgetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetToken_tokenHash_key" ON "WidgetToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "WidgetToken" ADD CONSTRAINT "WidgetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
