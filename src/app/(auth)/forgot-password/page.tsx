"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, CheckCircle } from "lucide-react";
import { forgotPasswordAction, resendConfirmationAction } from "@/app/actions/auth";

const forgotSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
});

type ForgotFormValues = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const [emailSent, setEmailSent] = useState(false);
  const [isResending, setIsResending] = useState(false);
  
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotSchema),
  });

  const onSubmit = async (data: ForgotFormValues) => {
    try {
      const result = await forgotPasswordAction(data.email);
      
      if (!result.success) {
        toast.error(result.error ?? "Erro ao enviar e-mail.");
        return;
      }

      setEmailSent(true);
      toast.success("E-mail enviado!", {
        description: "Verifique sua caixa de entrada e spam.",
      });
    } catch (error) {
      console.error("Erro ao recuperar senha:", error);
      toast.error("Erro inesperado. Tente novamente.");
    }
  };

  const handleResendConfirmation = async () => {
    const email = getValues("email");
    if (!email) {
      toast.error("Informe seu e-mail primeiro.");
      return;
    }

    setIsResending(true);
    try {
      const result = await resendConfirmationAction(email);
      
      if (!result.success) {
        toast.error(result.error ?? "Erro ao reenviar e-mail.");
        return;
      }

      toast.success("E-mail de confirmação reenviado!", {
        description: "Verifique sua caixa de entrada e spam.",
      });
    } catch (error) {
      console.error("Erro ao reenviar confirmação:", error);
      toast.error("Erro inesperado. Tente novamente.");
    } finally {
      setIsResending(false);
    }
  };

  if (emailSent) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-4 text-center">
          <CheckCircle className="h-16 w-16 text-success mx-auto" />
          <h1 className="text-2xl font-semibold text-foreground">
            E-mail enviado!
          </h1>
          <p className="text-sm text-muted-foreground">
            Enviamos um link para redefinir sua senha. Verifique sua caixa de entrada e pasta de spam.
          </p>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:text-primary/80">
            Voltar para o Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-foreground">
          Recuperar senha
        </h1>
        <p className="text-sm text-muted-foreground">
          Enviaremos um link para redefinir sua senha
        </p>
      </div>

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

        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Enviando...
            </span>
          ) : (
            "Recuperar Senha"
          )}
        </Button>
      </form>

      {/* Opção para reenviar e-mail de confirmação */}
      <div className="pt-4 border-t border-border">
        <p className="text-sm text-muted-foreground text-center mb-3">
          Não recebeu o e-mail de confirmação de cadastro?
        </p>
        <Button
          type="button"
          className="w-full"
          onClick={handleResendConfirmation}
          disabled={isResending}
        >
          {isResending ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reenviando...
            </span>
          ) : (
            "Reenviar E-mail de Confirmação"
          )}
        </Button>
      </div>

      <div className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:text-primary/80">
          Voltar para o Login
        </Link>
      </div>
    </div>
  );
}
