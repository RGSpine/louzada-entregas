"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitPlatformCustomizationLead } from "@/app/actions/platform-customization-lead";
import { getAuthPrefillAction } from "@/app/actions/auth";
import { clinicalPanelTransition } from "@/design/motion-presets";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import {
  platformCustomizationGlassCardClass,
  platformCustomizationGlassFieldClass,
} from "@/components/platform-customization/platform-customization-scenes";
import { cn } from "@/lib/utils";

type Props = {
  source: "public" | "dashboard";
  backHref: string;
  backLabel: string;
};

export function PlatformCustomizationForm({ source, backHref, backLabel }: Props) {
  const reduced = useReducedMotion();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [profileType, setProfileType] = useState<"solo" | "clinica" | "">("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [prefilling, setPrefilling] = useState(source === "dashboard");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (source !== "dashboard") return;

    void (async () => {
      try {
        const prefill = await getAuthPrefillAction();
        if (prefill.email) setEmail(prefill.email);
        if (prefill.name) setName(prefill.name);
      } finally {
        setPrefilling(false);
      }
    })();
  }, [source]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !profileType) {
      if (!profileType) toast.error("Selecione se é clínico solo ou clínica.");
      return;
    }

    setLoading(true);
    try {
      const result = await submitPlatformCustomizationLead({
        name,
        email,
        phone,
        profileType,
        description,
        source,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setSent(true);
      window.location.href = result.whatsappUrl;
      toast.success("Abra o WhatsApp e toque em Enviar para concluir.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Card className={platformCustomizationGlassCardClass}>
        <CardContent className="py-10 text-center">
          <p className="text-lg font-semibold text-foreground">
            Obrigado pelo seu interesse!
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Se o WhatsApp não abriu, verifique se o pop-up foi bloqueado e tente novamente.
          </p>
          <Button type="button" className="mt-6" variant="outline" asChild>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={clinicalPanelTransition}
    >
      <Card className={platformCustomizationGlassCardClass}>
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-bold text-foreground sm:text-2xl">
            Plataforma com a sua cara
          </CardTitle>
          <p
            className="mx-auto mt-3 max-w-lg rounded-xl border border-primary/50 bg-primary px-4 py-4 text-center text-sm font-bold leading-relaxed text-primary-foreground shadow-[var(--shadow-elevation-2)] dark:border-white/25 dark:bg-white dark:text-[#00008f] sm:text-base"
            role="note"
          >
            Preencha os dados abaixo. Ao enviar, o WhatsApp abrirá com sua mensagem pronta — basta
            tocar em{" "}
            <strong className="font-extrabold underline decoration-primary-foreground/90 underline-offset-2 dark:text-[#1d4f8c] dark:decoration-[#1d4f8c]/70">
              Enviar
            </strong>{" "}
            e nossa equipe retorna pelo seu número.
          </p>
        </CardHeader>
        <CardContent>
          {prefilling ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="pcl-name">Nome completo</Label>
                  <Input
                    id="pcl-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={120}
                    autoComplete="name"
                    className={platformCustomizationGlassFieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pcl-email">E-mail</Label>
                  <Input
                    id="pcl-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={200}
                    autoComplete="email"
                    className={platformCustomizationGlassFieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pcl-phone">WhatsApp</Label>
                  <Input
                    id="pcl-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="(16) 99999-9999"
                    maxLength={20}
                    autoComplete="tel"
                    className={platformCustomizationGlassFieldClass}
                  />
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">
                  Você é
                </legend>
                <div className="flex flex-wrap gap-3">
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                      platformCustomizationGlassFieldClass,
                    )}
                  >
                    <input
                      type="radio"
                      name="profileType"
                      value="solo"
                      checked={profileType === "solo"}
                      onChange={() => setProfileType("solo")}
                      className="accent-primary"
                    />
                    Clínico solo
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                      platformCustomizationGlassFieldClass,
                    )}
                  >
                    <input
                      type="radio"
                      name="profileType"
                      value="clinica"
                      checked={profileType === "clinica"}
                      onChange={() => setProfileType("clinica")}
                      className="accent-primary"
                    />
                    Tenho clínica / equipe
                  </label>
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="pcl-description">
                  O que você gostaria de modificar ou implementar?
                </Label>
                <Textarea
                  id="pcl-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  minLength={20}
                  maxLength={4000}
                  rows={6}
                  placeholder="Ex.: marca branca com meu logo, módulo de teleconsulta, integração com meu ERP, campos extras no prontuário..."
                  className={platformCustomizationGlassFieldClass}
                />
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="gap-2 bg-primary font-semibold shadow-[var(--shadow-elevation-2)] hover:bg-primary/90"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden />
                  )}
                  Enviar pelo WhatsApp
                </Button>
                <Button type="button" variant="ghost" asChild className="hover:bg-white/50 dark:hover:bg-white/10">
                  <Link href={backHref}>
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
                    {backLabel}
                  </Link>
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
