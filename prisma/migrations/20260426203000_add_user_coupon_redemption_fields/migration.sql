-- AlterTable
ALTER TABLE "User"
ADD COLUMN "coupon_redemption_code" TEXT,
ADD COLUMN "coupon_redeemed_at" TIMESTAMP(3);
