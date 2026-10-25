-- CreateTable
CREATE TABLE "user_access_session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'web',
    "device_label" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_access_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_access_session_user_id_last_seen_at_idx" ON "user_access_session"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_access_session_user_id_device_id_key" ON "user_access_session"("user_id", "device_id");

-- AddForeignKey
ALTER TABLE "user_access_session" ADD CONSTRAINT "user_access_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
