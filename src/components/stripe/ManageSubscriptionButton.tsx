"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Settings } from "lucide-react";
import { toast } from "sonner";

export function ManageSubscriptionButton({
  className,
  children = "Gerenciar Assinatura",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  const handleManage = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Erro ao abrir portal.");
        setLoading(false);
        return;
      }

      if (data.url) {
        toast.success("Redirecionando ao portal...");
        window.location.href = data.url;
        return;
      }

      toast.error("Resposta inválida do servidor.");
      setLoading(false);
    } catch (err) {
      console.error("[ManageSubscriptionButton]", err);
      toast.error("Erro de conexão. Tente novamente.");
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleManage}
      disabled={loading}
      variant="outline"
      className={
        className ??
        "w-full border-border bg-card font-medium text-foreground hover:bg-muted"
      }
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Redirecionando...
        </>
      ) : (
        <>
          <Settings className="w-4 h-4" />
          {children}
        </>
      )}
    </Button>
  );
}
