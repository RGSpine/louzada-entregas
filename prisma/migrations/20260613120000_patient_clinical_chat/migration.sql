-- CreateTable
CREATE TABLE "patient_chat_session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_chat_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_chat_message" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_chat_session_patient_id_key" ON "patient_chat_session"("patient_id");

-- CreateIndex
CREATE INDEX "patient_chat_session_user_id_updated_at_idx" ON "patient_chat_session"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_chat_session_user_id_patient_id_key" ON "patient_chat_session"("user_id", "patient_id");

-- CreateIndex
CREATE INDEX "patient_chat_message_session_id_created_at_idx" ON "patient_chat_message"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "patient_chat_session" ADD CONSTRAINT "patient_chat_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_chat_session" ADD CONSTRAINT "patient_chat_session_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_chat_message" ADD CONSTRAINT "patient_chat_message_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "patient_chat_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
