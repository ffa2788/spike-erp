-- CreateEnum
CREATE TYPE "ProductPath" AS ENUM ('RESALE', 'REPACK', 'MANUFACTURED');

-- CreateEnum
CREATE TYPE "FulfillmentPlace" AS ENUM ('WAREHOUSE', 'FBA', 'FBM');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('HOURLY', 'SALARY');

-- CreateEnum
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'POSTED');

-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'EXPORT';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "fulfillment" "FulfillmentPlace" NOT NULL DEFAULT 'WAREHOUSE';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "path" "ProductPath" NOT NULL DEFAULT 'MANUFACTURED';

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payType" "PayType" NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "federalWithholdingBps" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollTaxTable" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "socialSecurityBps" INTEGER NOT NULL DEFAULT 620,
    "socialSecurityWageBaseCents" INTEGER NOT NULL DEFAULT 17610000,
    "medicareBps" INTEGER NOT NULL DEFAULT 145,
    "futaBps" INTEGER NOT NULL DEFAULT 60,
    "futaWageBaseCents" INTEGER NOT NULL DEFAULT 700000,
    "floridaBps" INTEGER NOT NULL DEFAULT 270,
    "floridaWageBaseCents" INTEGER NOT NULL DEFAULT 700000,
    "note" TEXT NOT NULL DEFAULT 'Example rates. The accountant must review this table before a calculated pay run can be posted. SPIKE does not file payroll taxes.',

    CONSTRAINT "PayrollTaxTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'CALCULATOR',
    "journalId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayStub" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "grossCents" INTEGER NOT NULL,
    "federalWithholdingCents" INTEGER NOT NULL,
    "socialSecurityCents" INTEGER NOT NULL,
    "medicareCents" INTEGER NOT NULL,
    "employerSocialSecurityCents" INTEGER NOT NULL,
    "employerMedicareCents" INTEGER NOT NULL,
    "futaCents" INTEGER NOT NULL,
    "floridaCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,

    CONSTRAINT "PayStub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_number_key" ON "PayRun"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PayStub_runId_employeeId_key" ON "PayStub"("runId", "employeeId");

-- AddForeignKey
ALTER TABLE "PayStub" ADD CONSTRAINT "PayStub_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayStub" ADD CONSTRAINT "PayStub_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
