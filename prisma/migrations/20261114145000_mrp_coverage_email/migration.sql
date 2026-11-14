-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN     "emailDigest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastDigestOn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "maxQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "moq" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "orderMultiple" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "safetyQty" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DemandForecast" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DemandForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRecipient" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "productId" TEXT,
    "category" TEXT NOT NULL DEFAULT '',
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AlertRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "emailedOn" TIMESTAMP(3),

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemandForecast_productId_channel_weekOf_key" ON "DemandForecast"("productId", "channel", "weekOf");

-- AddForeignKey
ALTER TABLE "DemandForecast" ADD CONSTRAINT "DemandForecast_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
