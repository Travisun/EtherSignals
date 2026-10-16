-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "pushedAt" TIMESTAMPTZ(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'signal.trend',
    "symbol" TEXT NOT NULL,
    "marketType" TEXT NOT NULL DEFAULT 'futures',
    "price" DECIMAL(24,10),
    "timeframe" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "message" TEXT,
    "board" JSONB,
    "levels" JSONB,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMPTZ(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestLog" (
    "id" TEXT NOT NULL,
    "ip" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "signalId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Signal_pushedAt_key" ON "Signal"("pushedAt");

-- CreateIndex
CREATE INDEX "Signal_receivedAt_idx" ON "Signal"("receivedAt" DESC);

-- CreateIndex
CREATE INDEX "Signal_symbol_receivedAt_idx" ON "Signal"("symbol", "receivedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "IngestLog_createdAt_idx" ON "IngestLog"("createdAt" DESC);
