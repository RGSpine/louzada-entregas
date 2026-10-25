"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { BackNavLink } from "@/components/navigation/BackNav";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { signupAction } from "@/app/actions/auth";
import { stashPostSignupLogin } from "@/lib/auth/post-signup-login";
import { trackSignUp } from "@/lib/analytics/ga";
import { OpenInSafariBanner } from "@/components/auth/OpenInSafariBanner";
import { LouzadaLogo } from "@/components/brand/LouzadaLogo";
import { hardNavigate, waitForAuthSession } from "@/lib/auth/ensure-session-client";

const POST_SIGNUP_PATH = "/dashboard";

const registerSchema = z.object({
  fullName: z.string().min(2, "Informe seu nome."),
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres."),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormValues) => {
    try {
      stashPostSignupLogin(data.email, data.password);

      const formData = new FormData();
      formData.append("fullName", data.fullName);
      formData.append("email", data.email);
      formData.append("password", data.password);

      const result = await signupAction(formData);
      if (!result.success) {
        toast.error(result.error ?? "Não foi possível criar sua conta.");
        return;
      }

      trackSignUp("email");
      toast.success("Conta criada. Confira o e-mail se o acesso pedir confirmação.");

      const sessionOk = await waitForAuthSession();
      if (!sessionOk) {
        toast.error("Conta criada, mas a sessão não fixou neste navegador. Entre com o e-mail e a senha.", {
          duration: 12000,
        });
        hardNavigate(`/login?email=${encodeURIComponent(data.email)}`);
        return;
      }

      hardNavigate(result.redirectTo ?? POST_SIGNUP_PATH);
    } catch (error) {
      console.error("Erro ao cadastrar:", error);
      toast.error("Erro inesperado ao cadastrar.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <BackNavLink href="/" />
      <div className="space-y-2 text-center">
        <div className="mx-auto mb-2 grid w-full justify-center" style={{ gridTemplateColumns: "minmax(0, 16rem)" }}>
          <LouzadaLogo className="text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Criar conta</h1>
        <p className="text-sm text-muted-foreground">Nome, e-mail de confirmação e senha.</p>
      </div>

      <OpenInSafariBanner />

      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="fullName">Nome</Label>
          <Input id="fullName" type="text" autoComplete="name" placeholder="Seu nome" {...register("fullName")} />
          {errors.fullName ? <p className="text-xs text-destructive">{errors.fullName.message}</p> : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">E-mail de confirmação</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="voce@email.com" {...register("email")} />
          {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <div className="relative">
            <Input
              id="password"
              placeholder="Mínimo de 6 caracteres"
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
              {showPassword ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
            </button>
          </div>
          {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Enviando...
            </span>
          ) : (
            "Criar conta"
          )}
        </Button>
      </form>

      <div className="text-center text-sm text-muted-foreground">
        Já tem uma conta?{" "}
        <Link href="/login" className="text-primary hover:text-primary/80">
          Entrar
        </Link>
      </div>
    </div>
  );
}
