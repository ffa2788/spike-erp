CREATE TABLE "OperatingManual" (
    "id" TEXT NOT NULL DEFAULT 'manual',
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OperatingManual_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HelpRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "recordRef" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "answer" TEXT NOT NULL DEFAULT '',
    "answeredBy" TEXT NOT NULL DEFAULT '',
    "screenshot" BYTEA,
    "screenshotName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HelpRequest_status_createdAt_idx" ON "HelpRequest"("status", "createdAt");

CREATE INDEX "HelpRequest_userId_status_idx" ON "HelpRequest"("userId", "status");
