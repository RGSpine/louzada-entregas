-- CreateTable
CREATE TABLE "RemarketingContact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "profession" TEXT,
    "phone" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemarketingContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemarketingContact_email_idx" ON "RemarketingContact"("email");
