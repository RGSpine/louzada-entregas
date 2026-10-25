-- Rótulos CID-10 memorizados por utilizador (Perfil Clínico)
CREATE TABLE "UserCidProfileLabel" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "cid_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCidProfileLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserCidProfileLabel_user_id_cid_code_key" ON "UserCidProfileLabel"("user_id", "cid_code");
CREATE INDEX "UserCidProfileLabel_user_id_idx" ON "UserCidProfileLabel"("user_id");

ALTER TABLE "UserCidProfileLabel" ADD CONSTRAINT "UserCidProfileLabel_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (PostgREST / Supabase anon+authenticated)
ALTER TABLE "UserCidProfileLabel" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usercidprofilelabel_select_own" ON "UserCidProfileLabel";
CREATE POLICY "usercidprofilelabel_select_own" ON "UserCidProfileLabel"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "UserCidProfileLabel"."user_id"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "usercidprofilelabel_insert_own" ON "UserCidProfileLabel";
CREATE POLICY "usercidprofilelabel_insert_own" ON "UserCidProfileLabel"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "UserCidProfileLabel"."user_id"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "usercidprofilelabel_update_own" ON "UserCidProfileLabel";
CREATE POLICY "usercidprofilelabel_update_own" ON "UserCidProfileLabel"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "UserCidProfileLabel"."user_id"
        AND u.auth_user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "usercidprofilelabel_delete_own" ON "UserCidProfileLabel";
CREATE POLICY "usercidprofilelabel_delete_own" ON "UserCidProfileLabel"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "UserCidProfileLabel"."user_id"
        AND u.auth_user_id = auth.uid()::text
    )
  );
