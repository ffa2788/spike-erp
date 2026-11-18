-- CreateEnum
CREATE TYPE "ProductForm" AS ENUM ('LIQUID', 'POWDER', 'OTHER');

-- CreateEnum
CREATE TYPE "DocKind" AS ENUM ('TDS', 'SDS');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PackBasis" AS ENUM ('UNIT', 'CASE', 'PALLET');

-- AlterEnum
ALTER TYPE "ProductKind" ADD VALUE 'PACKAGING';

-- AlterTable
ALTER TABLE "Formula" ADD COLUMN     "specificGravity" DECIMAL(8,4);

-- AlterTable
ALTER TABLE "FormulaLine" ADD COLUMN     "qtyLb" DECIMAL(18,4) NOT NULL DEFAULT 0,
ALTER COLUMN "percent" SET DATA TYPE DECIMAL(10,4);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "appearance" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "flashPoint" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "form" "ProductForm" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "ghsClassification" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "nsfListingId" TEXT,
ADD COLUMN     "packingGroup" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "properShippingName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "solubility" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "specificGravity" DECIMAL(8,4),
ADD COLUMN     "transportClass" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "unNumber" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "NsfListing" (
    "id" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "function" TEXT NOT NULL,
    "maxUseMgL" DECIMAL(8,2) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "listedAsOf" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NsfListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagedSku" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "outputProductId" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "unitsPerCase" INTEGER NOT NULL,
    "casesPerPallet" INTEGER NOT NULL,
    "laborPerUnit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PackagedSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackBomLine" (
    "id" TEXT NOT NULL,
    "packagedSkuId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "basis" "PackBasis" NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "PackBomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackRun" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "packagedSkuId" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "packedOn" TIMESTAMP(3) NOT NULL,
    "journalId" TEXT,
    "contentsCostCents" INTEGER NOT NULL,
    "packagingCostCents" INTEGER NOT NULL,
    "laborCents" INTEGER NOT NULL,
    "outputLotId" TEXT,
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PackRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyDocument" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "DocKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "revisionOn" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "reviewedBy" TEXT NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SafetyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NsfListing_tradeName_key" ON "NsfListing"("tradeName");

-- CreateIndex
CREATE INDEX "PackagedSku_productId_packageCode_idx" ON "PackagedSku"("productId", "packageCode");

-- CreateIndex
CREATE UNIQUE INDEX "PackagedSku_outputProductId_key" ON "PackagedSku"("outputProductId");

-- CreateIndex
CREATE UNIQUE INDEX "PackRun_number_key" ON "PackRun"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyDocument_number_key" ON "SafetyDocument"("number");

-- CreateIndex
CREATE INDEX "SafetyDocument_kind_status_idx" ON "SafetyDocument"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyDocument_productId_kind_version_key" ON "SafetyDocument"("productId", "kind", "version");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_nsfListingId_fkey" FOREIGN KEY ("nsfListingId") REFERENCES "NsfListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagedSku" ADD CONSTRAINT "PackagedSku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagedSku" ADD CONSTRAINT "PackagedSku_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackBomLine" ADD CONSTRAINT "PackBomLine_packagedSkuId_fkey" FOREIGN KEY ("packagedSkuId") REFERENCES "PackagedSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackBomLine" ADD CONSTRAINT "PackBomLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackRun" ADD CONSTRAINT "PackRun_packagedSkuId_fkey" FOREIGN KEY ("packagedSkuId") REFERENCES "PackagedSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDocument" ADD CONSTRAINT "SafetyDocument_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
