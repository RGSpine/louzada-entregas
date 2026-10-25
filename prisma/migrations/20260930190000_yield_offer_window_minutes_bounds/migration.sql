-- Reforça o CHECK de minutos: bounds simétricos em [0, 1440] para start e end.
ALTER TABLE "YieldOfferWindow"
  DROP CONSTRAINT IF EXISTS "YieldOfferWindow_minutes_valid";

ALTER TABLE "YieldOfferWindow"
  ADD CONSTRAINT "YieldOfferWindow_minutes_valid" CHECK (
    "start_minute" >= 0
    AND "start_minute" <= 1440
    AND "end_minute" >= 0
    AND "end_minute" <= 1440
    AND "start_minute" < "end_minute"
  );
