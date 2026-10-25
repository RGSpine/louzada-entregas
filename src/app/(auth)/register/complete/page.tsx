"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { BackNavLink } from "@/components/navigation/BackNav";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  completeGoogleSignupAction,
  getAuthPrefillAction,
  getAuthProfileStatusAction,
  logoutAction,
} from "@/app/actions/auth";
import { claimAccessSessionClient } from "@/lib/access-session-client";
import { OpenInSafariBanner } from "@/components/auth/OpenInSafariBanner";
import { hardNavigate, waitForAuthSession } from "@/lib/auth/ensure-session-client";

const completeSchema = z.object({
  fullName: z.string().min(2, "Informe seu nome."),
  email: z.string().email(),
});

type CompleteFormValues = z.infer<typeof completeSchema>;

export default function RegisterCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      }
    >
      <RegisterCompleteContent />
    </Suspense>
  );
}

function RegisterCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checkingSession, setCheckingSession] = useState(true);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CompleteFormValues>({
    resolver: zodResolver(completeSchema),
  });

  const fromSignup = searchParams.get("from") === "signup";

  useEffect(() => {
    const boot = async () => {
      const status = await getAuthProfileStatusAction();
      if (!status.authenticated) {
        router.replace("/login?redirect=/register/complete");
        return;
      }
      if (status.profileComplete) {
        router.replace("/dashboard");
        return;
      }

      const prefill = await getAuthPrefillAction();
      if (prefill.name) setValue("fullName", prefill.name);
      if (prefill.email) setValue("email", prefill.email);
      setCheckingSession(false);
    };
    void boot();
  }, [router, setValue]);

  const onSubmit = async (data: CompleteFormValues) => {
    try {
      const formData = new FormData();
      formData.append("fullName", data.fullName);

      const result = await completeGoogleSignupAction(formData);
      if (!result.success) {
        toast.error(result.error ?? "Não foi possível completar o cadastro.");
        return;
      }

      const nextRaw = searchParams.get("next");
      const next = nextRaw?.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;
      const goingToDashboard = fromSignup || !next || next.startsWith("/dashboard");

      if (!goingToDashboard) {
        const claimed = await claimAccessSessionClient();
        if (!claimed.ok) {
          if (claimed.errorCode === "CHECKOUT_REQUIRED") {
            hardNavigate(claimed.redirectTo ?? "/dashboard");
            return;
          }
          toast.error(claimed.error ?? "Não foi possível abrir a sessão neste aparelho.", { duration: 9000 });
          try {
            await logoutAction();
          } catch {
            // ignore
          }
          return;
        }
      } else {
        void claimAccessSessionClient();
      }

      toast.success("Conta pronta.");
      if (goingToDashboard) {
        const sessionOk = await waitForAuthSession();
        if (!sessionOk) {
          hardNavigate("/login?reason=session_expired");
          return;
        }
        hardNavigate("/dashboard");
        return;
      }

      router.replace(next);
    } catch (error) {
      console.error("Erro ao completar cadastro:", error);
      toast.error("Erro inesperado ao completar cadastro.");
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <BackNavLink href="/login" />
      <OpenInSafariBanner />
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Complete seu cadastro</h1>
        <p className="text-sm text-muted-foreground">Confirme o nome. O e-mail já veio da conta.</p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="fullName">Nome</Label>
          <Input id="fullName" autoComplete="name" {...register("fullName")} />
          {errors.fullName ? <p className="text-xs text-destructive">{errors.fullName.message}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail de confirmação</Label>
          <Input id="email" type="email" readOnly className="bg-muted" {...register("email")} />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando...
            </span>
          ) : (
            "Concluir cadastro"
          )}
        </Button>
      </form>
    </div>
  );
}
