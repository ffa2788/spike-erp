-- CreateEnum
CREATE TYPE "Incoterm" AS ENUM ('EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP');

-- CreateEnum
CREATE TYPE "CreditTerm" AS ENUM ('PREPAID', 'COD', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('NONE', 'PERCENT', 'AMOUNT');

-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'WALMART';

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'VOID';

-- AlterEnum
ALTER TYPE "QuoteStatus" ADD VALUE 'SUPERSEDED';

-- DropIndex
DROP INDEX "Quote_number_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "creditTerm" "CreditTerm" NOT NULL DEFAULT 'NET_30',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "customNetDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "docDiscountKind" "DiscountKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "docDiscountValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyPayBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyPayDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyTakenCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "freightCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "goodsNetCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "incoterm" "Incoterm" NOT NULL DEFAULT 'EXW',
ADD COLUMN     "insuranceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "marketplaceOrderId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "namedPlace" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountKind" "DiscountKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "discountValue" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "priceLevel" TEXT NOT NULL DEFAULT 'LIST';

-- AlterTable
ALTER TABLE "PaymentApplication" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "creditTerm" "CreditTerm" NOT NULL DEFAULT 'NET_30',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "customNetDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "docDiscountKind" "DiscountKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "docDiscountValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyPayBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyPayDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "freightCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "goodsNetCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "incoterm" "Incoterm" NOT NULL DEFAULT 'EXW',
ADD COLUMN     "insuranceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "namedPlace" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "revision" TEXT NOT NULL DEFAULT 'A';

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountKind" "DiscountKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "discountValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priceSource" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "creditTerm" "CreditTerm" NOT NULL DEFAULT 'NET_30',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "customNetDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "docDiscountKind" "DiscountKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "docDiscountValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyPayBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyPayDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "freightCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "goodsNetCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "incoterm" "Incoterm" NOT NULL DEFAULT 'EXW',
ADD COLUMN     "insuranceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "namedPlace" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SalesOrderLine" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountKind" "DiscountKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "discountValue" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PriceBreak" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceLevel" TEXT NOT NULL,
    "minQty" DECIMAL(18,4) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "PriceBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceBreak_productId_priceLevel_minQty_key" ON "PriceBreak"("productId", "priceLevel", "minQty");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_revision_key" ON "Quote"("number", "revision");

-- AddForeignKey
ALTER TABLE "PriceBreak" ADD CONSTRAINT "PriceBreak_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
