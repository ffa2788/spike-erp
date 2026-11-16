-- CreateTable
CREATE TABLE "AmazonSettlementLine" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "postedAt" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "orderId" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fulfillment" TEXT NOT NULL DEFAULT '',
    "productSalesCents" INTEGER NOT NULL DEFAULT 0,
    "sellingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "fbaFeeCents" INTEGER NOT NULL DEFAULT 0,
    "otherTransactionFeeCents" INTEGER NOT NULL DEFAULT 0,
    "otherCents" INTEGER NOT NULL DEFAULT 0,
    "promotionalRebatesCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "journalId" TEXT,
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AmazonSettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSettlementLine_fingerprint_key" ON "AmazonSettlementLine"("fingerprint");
