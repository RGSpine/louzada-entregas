"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmPasswordRecoveryAction } from "@/app/actions/auth";

type Props = {
  tokenHash: string;
};

/**
 * Confirmação explícita antes de consumir o OTP (prefetch de e-mail não queima o link).
 */
export function RecoveryConfirmClient({ tokenHash }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const onConfirm = async () => {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const result = await confirmPasswordRecoveryAction(tokenHash);
      if (!result.success) {
        setFailed(true);
        toast.error(result.error ?? "Link inválido ou expirado.");
        return;
      }
      toast.success("Link validado! Defina sua nova senha.");
      router.replace("/reset-password?from=recovery");
    } catch (err) {
      console.error("[RecoveryConfirmClient]", err);
      setFailed(true);
      toast.error("Erro ao validar o link. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  if (failed) {
    return (
      <div className="mx-auto w-full max-w-md space-y-6 text-center">
        <AlertCircle className="mx-auto h-14 w-14 text-destructive" />
        <h1 className="text-2xl font-semibold text-foreground">Link inválido ou expirado</h1>
        <p className="text-sm text-muted-foreground">
          Este link já foi usado ou expirou. Solicite um novo e-mail e abra-o uma única vez no
          navegador (evite pré-visualizar no app de e-mail).
        </p>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Solicitar novo link</Link>
        </Button>
        <Link href="/login" className="block text-sm text-primary hover:text-primary/80">
          Voltar para o Login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6 text-center">
      <KeyRound className="mx-auto h-14 w-14 text-primary" aria-hidden />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">Redefinir senha</h1>
        <p className="text-sm text-muted-foreground">
          Clique no botão abaixo para validar o link com segurança e escolher uma nova senha.
        </p>
      </div>
      <Button type="button" className="w-full" disabled={loading} onClick={() => void onConfirm()}>
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Validando...
          </span>
        ) : (
          "Continuar para redefinir senha"
        )}
      </Button>
      <Link href="/forgot-password" className="block text-sm text-muted-foreground hover:text-primary">
        Solicitar novo link
      </Link>
    </div>
  );
}
