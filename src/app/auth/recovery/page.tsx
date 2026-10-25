import Link from "next/link";
import { RecoveryConfirmClient } from "@/components/auth/RecoveryConfirmClient";
import { Button } from "@/components/ui/button";

type SearchParams = Promise<{ token_hash?: string; type?: string }>;

/**
 * Landing do e-mail de recuperação.
 * Lê token_hash no servidor (sem race de useSearchParams) e só consome o OTP após confirmação.
 */
export default async function AuthRecoveryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const tokenHash = params.token_hash?.trim() ?? "";
  const type = params.type?.trim() ?? "";

  if (!tokenHash || type !== "recovery") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-elevation-3)]">
          <h1 className="text-xl font-semibold text-foreground">Link incompleto</h1>
          <p className="text-sm text-muted-foreground">
            Este endereço não contém um token de recuperação válido. Solicite um novo e-mail.
          </p>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Recuperar senha</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-elevation-3)]">
        <RecoveryConfirmClient tokenHash={tokenHash} />
      </div>
    </div>
  );
}
