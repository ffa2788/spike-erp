-- AlterTable
ALTER TABLE "FbaBalance" ADD COLUMN     "daysOfSupply" DECIMAL(18,4),
ADD COLUMN     "reserved" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shipped30" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "unfulfillable" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AmazonSkuMap" (
    "id" TEXT NOT NULL,
    "amazonSku" TEXT NOT NULL,
    "asin" TEXT NOT NULL DEFAULT '',
    "productId" TEXT,

    CONSTRAINT "AmazonSkuMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonOrderItem" (
    "id" TEXT NOT NULL,
    "amazonOrderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "lastUpdated" TEXT NOT NULL DEFAULT '',
    "orderStatus" TEXT NOT NULL DEFAULT '',
    "fulfillment" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "asin" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(18,4) NOT NULL,
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "shipCity" TEXT NOT NULL DEFAULT '',
    "shipState" TEXT NOT NULL DEFAULT '',
    "shipPostalCode" TEXT NOT NULL DEFAULT '',
    "shipCountry" TEXT NOT NULL DEFAULT '',
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "shipped" BOOLEAN NOT NULL DEFAULT false,
    "productId" TEXT,
    "invoiceId" TEXT,
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AmazonOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSkuMap_amazonSku_key" ON "AmazonSkuMap"("amazonSku");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonOrderItem_amazonOrderId_orderItemId_key" ON "AmazonOrderItem"("amazonOrderId", "orderItemId");

-- AddForeignKey
ALTER TABLE "AmazonSkuMap" ADD CONSTRAINT "AmazonSkuMap_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
