-- Uma única entrada INCOME por compra (evita corrida TOCTOU entre
-- createFinancialTransaction e createPatientPurchase/registerIncome).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FinancialTransaction"
    WHERE kind = 'INCOME' AND purchase_id IS NOT NULL
    GROUP BY purchase_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Há compras com mais de uma entrada INCOME. Corrija os registros antes do índice único parcial.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "FinancialTransaction_purchase_id_income_uidx"
  ON "FinancialTransaction" ("purchase_id")
  WHERE kind = 'INCOME' AND purchase_id IS NOT NULL;
