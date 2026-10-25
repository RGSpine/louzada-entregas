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
import { loginAction } from "@/app/actions/auth";
import { OpenInSafariBanner } from "@/components/auth/OpenInSafariBanner";
import { BackNavLink } from "@/components/navigation/BackNav";
import {
  hardNavigate,
  waitForAuthSession,
} from "@/lib/auth/ensure-session-client";
import { safeMarketplaceRedirect } from "@/lib/marketplace/paths";

const STORAGE_KEY = "ai_evolui_patient_remember_me";

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/**
 * Login paciente — espelha UX do pro sem Stripe/Google; destino padrão `/mapa-saude`.
 */
export function PatientLoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [signupHref, setSignupHref] = useState("/cadastro-paciente");

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const emailFromQuery = (params.get("email") ?? "").trim();
      const marketplaceNext = safeMarketplaceRedirect(params.get("redirect"));
      const convite = params.get("convite");
      if (marketplaceNext || convite) {
        const next = new URLSearchParams();
        if (marketplaceNext) next.set("redirect", marketplaceNext);
        if (convite) next.set("convite", convite);
        setSignupHref(`/cadastro-paciente?${next.toString()}`);
      }

      if (params.get("reason") === "blocked") {
        toast.error("Sua conta está bloqueada. Entre em contato com o suporte.");
      }
      if (params.get("reason") === "session_expired") {
        toast.error(
          "Sua sessão expirou. No iPhone, abra o Safari (não o WhatsApp) e entre de novo.",
          { duration: 10000 },
        );
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
        if (email && !emailFromQuery) setValue("email", email);
        if (password) setValue("password", password);
        setShowPassword(false);
      }
    } catch (error) {
      console.error("Erro ao carregar dados salvos (paciente):", error);
      setRememberMe(false);
    }
  }, [setValue]);

  const onSubmit = async (data: LoginFormValues) => {
    try {
      let result: {
        success: boolean;
        error?: string;
        needsCheckout?: boolean;
        redirectTo?: string;
      };

      try {
        const marketplaceRedirect =
          safeMarketplaceRedirect(
            new URLSearchParams(window.location.search).get("redirect"),
          ) ?? "/mapa-saude";
        const res = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            email: data.email,
            password: data.password,
            redirect: marketplaceRedirect,
            inviteToken:
              new URLSearchParams(window.location.search).get("convite") ?? undefined,
          }),
        });
        result = (await res.json()) as typeof result;
        if (!res.ok && !result.error) {
          result = { success: false, error: "Não foi possível fazer login." };
        }
      } catch {
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

      const sessionOk = await waitForAuthSession();
      if (!sessionOk) {
        console.warn("[paciente/login] refresh imediato falhou; seguindo com cookies");
      }

      toast.success("Login realizado com sucesso!");

      const marketplaceNext =
        safeMarketplaceRedirect(result.redirectTo) ??
        safeMarketplaceRedirect(
          new URLSearchParams(window.location.search).get("redirect"),
        ) ??
        "/mapa-saude";

      // Paciente não passa por claim de sessão B2B / Stripe.
      if (result.needsCheckout) {
        hardNavigate(marketplaceNext);
        return;
      }

      hardNavigate(marketplaceNext);
    } catch (error) {
      console.error("Erro ao fazer login (paciente):", error);
      toast.error("Erro inesperado ao fazer login.");
    }
  };

  const handleRememberMeChange = (checked: boolean) => {
    setRememberMe(checked);
    if (!checked) localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <BackNavLink href="/paciente" />
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold text-foreground">
          Entrar no Mapa de Saúde
        </h1>
        <p className="text-sm text-muted-foreground">
          Acesse sua conta de paciente no Louzada Entregas
        </p>
      </div>

      <OpenInSafariBanner />

      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="patient-email" className="text-foreground/90">
            E-mail
          </Label>
          <Input
            id="patient-email"
            type="email"
            placeholder="voce@email.com"
            autoComplete="email"
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="patient-password" className="text-foreground/90">
            Senha
          </Label>
          <div className="relative">
            <Input
              id="patient-password"
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
          <label className="group flex cursor-pointer items-center gap-2">
            <div className="relative">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => handleRememberMeChange(e.target.checked)}
                className="peer sr-only"
              />
              <div className="h-4 w-4 rounded border border-border bg-card transition-colors peer-checked:border-primary peer-checked:bg-primary">
                {rememberMe && (
                  <svg
                    className="h-4 w-4 text-white"
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
            <span className="select-none text-muted-foreground transition-colors group-hover:text-foreground">
              Lembrar meu e-mail e senha
            </span>
          </label>

          <Link
            href="/forgot-password"
            className="text-primary hover:text-primary/80"
          >
            Esqueci minha senha
          </Link>
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
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
        <Link href={signupHref} className="text-primary hover:text-primary/80">
          Criar conta de paciente
        </Link>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        É profissional?{" "}
        <Link href="/login" className="font-medium text-primary hover:text-primary/80">
          Entrar no consultório
        </Link>
      </p>
    </div>
  );
}
