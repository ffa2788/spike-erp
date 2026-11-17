CREATE TABLE "AmazonAssembly" (
  "id" TEXT NOT NULL,
  "packedOn" TIMESTAMP(3) NOT NULL,
  "productId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "units" INTEGER NOT NULL,
  "runId" TEXT NOT NULL DEFAULT '',
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "AmazonAssembly_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonInvoiceFile" (
  "invoiceId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "pdf" BYTEA NOT NULL,
  CONSTRAINT "AmazonInvoiceFile_pkey" PRIMARY KEY ("invoiceId")
);
