-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('C_CORP', 'S_CORP');

-- CreateEnum
CREATE TYPE "InfoReturn" AS ENUM ('NONE', 'NEC', 'MISC');

-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN     "entityType" "EntityType" NOT NULL DEFAULT 'S_CORP';

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "infoReturn" "InfoReturn" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "w9OnFile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "w9ReceivedOn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "placedInService" TIMESTAMP(3) NOT NULL,
    "costCents" INTEGER NOT NULL,
    "section179Candidate" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);
