"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GoogleMarkIcon } from "@/components/icons/GoogleMarkIcon";
import { signInWithGoogleAction } from "@/app/actions/auth";

type Props = {
  intent?: "login" | "signup";
  next?: string;
  label?: string;
};

export function GoogleSignInButton({
  intent = "login",
  next,
  label = "Continuar com Google",
}: Props) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const result = await signInWithGoogleAction({ intent, next });
      if (!result.success || !result.url) {
        toast.error(result.error ?? "Não foi possível iniciar o login com Google.");
        setLoading(false);
        return;
      }
      window.location.href = result.url;
    } catch {
      toast.error("Erro inesperado ao conectar com Google.");
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-2"
      onClick={() => void handleClick()}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      ) : (
        <GoogleMarkIcon className="h-5 w-5" />
      )}
      {loading ? "Redirecionando..." : label}
    </Button>
  );
}
