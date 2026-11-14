-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "coverDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "FbaBalance" (
    "productId" TEXT NOT NULL,
    "fulfillable" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inbound" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbaBalance_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ScheduleRelease" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "windowWeeks" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "emailedTo" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleReleaseLine" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "fbaQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "formulaVersion" INTEGER,
    "pullLot" TEXT NOT NULL DEFAULT '',
    "materials" TEXT NOT NULL DEFAULT '',
    "daysCover" DECIMAL(18,4),
    "shortage" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScheduleReleaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRelease_number_key" ON "ScheduleRelease"("number");

-- AddForeignKey
ALTER TABLE "ScheduleReleaseLine" ADD CONSTRAINT "ScheduleReleaseLine_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ScheduleRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
