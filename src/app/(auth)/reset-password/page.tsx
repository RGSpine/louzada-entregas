"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, CheckCircle, AlertCircle } from "lucide-react";
import { updatePasswordAction } from "@/app/actions/auth";
import { exchangeAuthSession, parseSupabaseHashTokens } from "@/lib/auth-exchange-client";

const resetSchema = z
  .object({
    password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres."),
    confirmPassword: z.string().min(6, "Confirme sua senha."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

type ResetFormValues = z.infer<typeof resetSchema>;

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md space-y-6">
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Carregando...</p>
          </div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isValidToken, setIsValidToken] = useState<boolean | null>(null);
  const [isCheckingToken, setIsCheckingToken] = useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
  });

  useEffect(() => {
    const boot = async () => {
      try {
        const tokenHash = searchParams.get("token_hash");
        const type = searchParams.get("type");

        // Links antigos/ branded → landing dedicada (server lê o token; anti-scanner)
        if (tokenHash && type === "recovery") {
          const q = new URLSearchParams({ token_hash: tokenHash, type: "recovery" });
          router.replace(`/auth/recovery?${q.toString()}`);
          return;
        }

        const code = searchParams.get("code");
        if (code) {
          const result = await exchangeAuthSession({ kind: "code", code });
          setIsValidToken(result.ok);
          if (!result.ok) toast.error(result.error ?? "Link inválido ou expirado.");
          setIsCheckingToken(false);
          return;
        }

        const hash = window.location.hash;
        if (hash && (hash.includes("access_token") || hash.includes("type=recovery"))) {
          const { accessToken, refreshToken } = parseSupabaseHashTokens(hash);
          if (accessToken && refreshToken) {
            const result = await exchangeAuthSession({
              kind: "tokens",
              accessToken,
              refreshToken,
            });
            setIsValidToken(result.ok);
            if (result.ok) {
              window.history.replaceState(null, "", "/reset-password?from=recovery");
            } else {
              toast.error(result.error ?? "Link inválido ou expirado.");
            }
            setIsCheckingToken(false);
            return;
          }
        }

        // Sessão de recovery já criada em /auth/recovery
        const refreshRes = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
        });
        setIsValidToken(refreshRes.ok);
        if (!refreshRes.ok && searchParams.get("from") === "recovery") {
          toast.error("Sessão de recuperação expirada. Solicite um novo link.");
        }
      } catch (error) {
        console.error("Erro ao verificar token:", error);
        setIsValidToken(false);
      } finally {
        setIsCheckingToken(false);
      }
    };

    void boot();
  }, [searchParams, router]);

  const onSubmit = async (data: ResetFormValues) => {
    try {
      const result = await updatePasswordAction(data.password);
      if (!result.success) {
        toast.error(result.error ?? "Erro ao atualizar senha.");
        return;
      }

      setIsSuccess(true);
      toast.success("Senha atualizada com sucesso!");
      setTimeout(() => {
        router.push("/login");
      }, 2500);
    } catch (error) {
      console.error("Erro ao redefinir senha:", error);
      toast.error("Erro inesperado. Tente novamente.");
    }
  };

  if (isCheckingToken) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando link de recuperação...</p>
        </div>
      </div>
    );
  }

  if (isValidToken === false) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-4 text-center">
          <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
          <h1 className="text-2xl font-semibold text-foreground">Link inválido ou expirado</h1>
          <p className="text-sm text-muted-foreground">
            Solicite um novo e-mail de recuperação e use o botão Continuar na página que abrir.
          </p>
        </div>
        <div className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/forgot-password">Solicitar novo link</Link>
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="text-primary hover:text-primary/80">
              Voltar para o Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-4 text-center">
          <CheckCircle className="mx-auto h-16 w-16 text-success" />
          <h1 className="text-2xl font-semibold text-foreground">Senha atualizada!</h1>
          <p className="text-sm text-muted-foreground">
            Redirecionando para o login...
          </p>
        </div>
        <div className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:text-primary/80">
            Ir para o Login agora
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Redefinir senha</h1>
        <p className="text-sm text-muted-foreground">Digite sua nova senha abaixo</p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-muted-foreground">
            Nova Senha
          </Label>
          <div className="relative">
            <Input
              id="password"
              placeholder="Digite sua nova senha"
              autoComplete="new-password"
              className="pr-10"
              {...register("password")}
              type={showPassword ? "text" : "password"}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
              {showPassword ? (
                <EyeOff className="h-5 w-5" aria-hidden />
              ) : (
                <Eye className="h-5 w-5" aria-hidden />
              )}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className="text-muted-foreground">
            Confirmar Nova Senha
          </Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              placeholder="Repita sua nova senha"
              autoComplete="new-password"
              className="pr-10"
              {...register("confirmPassword")}
              type={showConfirmPassword ? "text" : "password"}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={
                showConfirmPassword
                  ? "Ocultar confirmação de senha"
                  : "Mostrar confirmação de senha"
              }
              aria-pressed={showConfirmPassword}
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
              {showConfirmPassword ? (
                <EyeOff className="h-5 w-5" aria-hidden />
              ) : (
                <Eye className="h-5 w-5" aria-hidden />
              )}
            </button>
          </div>
          {errors.confirmPassword && (
            <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Atualizando...
            </span>
          ) : (
            "Redefinir Senha"
          )}
        </Button>
      </form>

      <div className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:text-primary/80">
          Voltar para o Login
        </Link>
      </div>
    </div>
  );
}
