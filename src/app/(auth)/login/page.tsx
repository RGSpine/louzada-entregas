"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { loginAction, logoutAction } from "@/app/actions/auth";
import { claimAccessSessionClient } from "@/lib/access-session-client";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AuthDivider } from "@/components/auth/AuthDivider";
import { OpenInSafariBanner } from "@/components/auth/OpenInSafariBanner";
import { BackNavLink } from "@/components/navigation/BackNav";
import {
  clearPostSignupLogin,
  readPostSignupLogin,
} from "@/lib/auth/post-signup-login";
import { isGoogleAuthAllowlistedEmail } from "@/lib/auth/google-auth-allowlist";
import {
  hardNavigate,
  waitForAuthSession,
} from "@/lib/auth/ensure-session-client";
import { safeMarketplaceRedirect } from "@/lib/marketplace/paths";
import { LouzadaLogo } from "@/components/brand/LouzadaLogo";

const STORAGE_KEY = "ai_evolui_remember_me";

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const emailValue = watch("email");
  const showGoogleAuth = isGoogleAuthAllowlistedEmail(emailValue);

  // Carregar dados salvos do localStorage / pós-checkout Stripe
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const checkoutOk = params.get("checkout") === "success";
      const emailFromQuery = (params.get("email") ?? "").trim();
      const stashed = readPostSignupLogin();

      if (checkoutOk) {
        toast.success(
          "Pagamento confirmado! Sua conta está ativa. Entre com seu e-mail e senha.",
          { duration: 8000 },
        );
      }

      if (stashed) {
        setValue("email", stashed.email);
        setValue("password", stashed.password);
        clearPostSignupLogin();
        return;
      }

      if (emailFromQuery) {
        setValue("email", emailFromQuery);
      }

      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        const { email, password } = JSON.parse(savedData) as {
          email?: string;
          password?: string;
        };
        setRememberMe(Boolean(email));
        if (email && !emailFromQuery) {
          setValue("email", email);
        }
        if (password) {
          setValue("password", password);
        }
        setShowPassword(false);
      } else {
        setRememberMe(false);
      }
    } catch (error) {
      console.error("Erro ao carregar dados salvos:", error);
      setRememberMe(false);
    }
  }, [setValue]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("reason") === "blocked") {
      toast.error("Sua conta está bloqueada. Entre em contato com o suporte.");
    }
    if (p.get("reason") === "access_limit") {
      toast.error(
        "Esta conta já está em uso no número máximo de aparelhos do seu plano. Encerre a sessão em outro dispositivo e tente novamente.",
        { duration: 9000 },
      );
    }
    if (p.get("reason") === "session_expired") {
      toast.error(
        "Sua sessão expirou ou o navegador bloqueou o login. No iPhone, abra o Safari (não o WhatsApp) e entre de novo.",
        { duration: 10000 },
      );
    }
    if (p.get("error") === "oauth") {
      toast.error(
        "Não foi possível entrar com Google. Tente novamente ou use e-mail e senha.",
        { duration: 9000 },
      );
    }
    if (p.get("error") === "oauth_restricted") {
      toast.error(
        "Login com Google está disponível apenas para contas de teste internas.",
        { duration: 9000 },
      );
    }
  }, []);

  const onSubmit = async (data: LoginFormValues) => {
    try {
      // iOS/Safari: Route Handler grava Set-Cookie no Response (mais fiável que Server Action).
      let result: {
        success: boolean;
        error?: string;
        needsCheckout?: boolean;
        redirectTo?: string;
      };

      try {
        const marketplaceRedirect =
          typeof window !== "undefined"
            ? safeMarketplaceRedirect(new URLSearchParams(window.location.search).get("redirect"))
            : null;
        const res = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            email: data.email,
            password: data.password,
            redirect: marketplaceRedirect ?? undefined,
          }),
        });
        result = (await res.json()) as typeof result;
        if (!res.ok && !result.error) {
          result = { success: false, error: "Não foi possível fazer login." };
        }
      } catch {
        // Fallback Server Action se a API falhar (rede/edge).
        result = await loginAction(data.email, data.password);
      }

      if (!result.success) {
        toast.error(result.error ?? "Não foi possível fazer login.");
        return;
      }

      if (rememberMe) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ email: data.email, password: data.password }),
        );
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      // Confirma cookies httpOnly. Se o refresh imediato falhar, seguimos:
      // o POST /login já emitiu Set-Cookie e o dashboard valida a sessão.
      const sessionOk = await waitForAuthSession();
      if (!sessionOk) {
        console.warn("[login] refresh imediato falhou; seguindo com os cookies do login");
      }

      toast.success("Login realizado com sucesso!");

      const marketplaceNext =
        safeMarketplaceRedirect(result.redirectTo) ??
        (typeof window !== "undefined"
          ? safeMarketplaceRedirect(new URLSearchParams(window.location.search).get("redirect"))
          : null);
      if (marketplaceNext) {
        hardNavigate(marketplaceNext);
        return;
      }

      if (result.needsCheckout) {
        hardNavigate(result.redirectTo ?? "/dashboard");
        return;
      }

      const claimed = await claimAccessSessionClient();
      if (!claimed.ok) {
        if (claimed.errorCode === "CHECKOUT_REQUIRED") {
          hardNavigate(claimed.redirectTo ?? "/dashboard");
          return;
        }
        toast.error(
          claimed.error ??
            "Limite de acessos simultâneos atingido. Encerre a sessão em outro dispositivo e tente novamente.",
          { duration: 9000 },
        );
        try {
          await logoutAction();
        } catch {
          // ignore
        }
        return;
      }

      let nextPath = "/dashboard";
      if (typeof window !== "undefined") {
        const p = new URLSearchParams(window.location.search);
        const r = p.get("redirect");
        if (r?.startsWith("/") && !r.startsWith("//")) nextPath = r;
      }
      hardNavigate(nextPath);
    } catch (error) {
      console.error("Erro ao fazer login:", error);
      toast.error("Erro inesperado ao fazer login.");
    }
  };

  // Função para alternar "Lembrar-me" e limpar dados se desmarcar
  const handleRememberMeChange = (checked: boolean) => {
    setRememberMe(checked);
    if (!checked) {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <BackNavLink href="/" />
      <div className="space-y-2 text-center">
        <div className="mx-auto grid w-full justify-center" style={{ gridTemplateColumns: "minmax(0, 16rem)" }}>
          <LouzadaLogo className="text-primary" />
        </div>
        <h1 className="text-3xl font-semibold text-foreground">
          Bem-vindo de volta
        </h1>
        <p className="text-sm text-muted-foreground">
          Acesse sua conta profissional do Louzada Entregas
        </p>
      </div>

      <OpenInSafariBanner />

      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-foreground/90">
            E-mail
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="voce@email.com"
           
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        {showGoogleAuth ? (
          <div className="space-y-4">
            <GoogleSignInButton intent="login" />
            <AuthDivider />
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="password" className="text-foreground/90">
            Senha
          </Label>
          <div className="relative">
            <Input
              id="password"
              placeholder="Digite sua senha"
              autoComplete="current-password"
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

        <div className="flex items-center justify-between text-sm">
          {/* Checkbox Lembrar-me */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => handleRememberMeChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-4 h-4 border border-border rounded bg-card peer-checked:bg-primary peer-checked:border-primary transition-colors">
                {rememberMe && (
                  <svg
                    className="w-4 h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-muted-foreground group-hover:text-foreground transition-colors select-none">
              Lembrar meu e-mail e senha
            </span>
          </label>

          <Link href="/forgot-password" className="text-primary hover:text-primary/80">
            Esqueci minha senha
          </Link>
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Entrando...
            </span>
          ) : (
            "Entrar"
          )}
        </Button>
      </form>

      <div className="text-center text-sm text-muted-foreground">
        Não tem conta?{" "}
        <Link href="/register" className="text-primary hover:text-primary/80">
          Crie agora
        </Link>
      </div>
    </div>
  );
}
