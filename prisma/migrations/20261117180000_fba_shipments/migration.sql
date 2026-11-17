CREATE TABLE "FbaShipment" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "shippedOn" TIMESTAMP(3) NOT NULL,
  "freightCents" INTEGER NOT NULL DEFAULT 0,
  "spreadBy" TEXT NOT NULL DEFAULT 'UNITS',
  "status" TEXT NOT NULL DEFAULT 'IN_TRANSIT',
  "journalId" TEXT,
  CONSTRAINT "FbaShipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbaShipment_shipmentId_key" ON "FbaShipment"("shipmentId");

CREATE TABLE "FbaShipmentLine" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sourceLotId" TEXT NOT NULL,
  "fbaLotId" TEXT NOT NULL,
  "qtyShipped" DECIMAL(18,4) NOT NULL,
  "qtyReceived" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "weightLb" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "landedUnitCost" DECIMAL(18,6) NOT NULL,
  "claimQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  CONSTRAINT "FbaShipmentLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FbaShipmentLine" ADD CONSTRAINT "FbaShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "FbaShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
