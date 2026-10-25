"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deactivateServiceSpace,
  listServiceSpaces,
  upsertServiceSpace,
  type ServiceSpaceRow,
} from "@/app/actions/service-spaces";
import {
  DEFAULT_SERVICE_SPACE_COLOR,
  SERVICE_SPACE_COLOR_PALETTE,
} from "@/lib/service-spaces/access";
import { financeOutlineBtnClass } from "./finance-outline-btn";

type Props = {
  /** Se false, painel fica oculto (plano sem Espaços). */
  enabled: boolean;
  readOnly?: boolean;
};

export function ServiceSpacesConfigPanel({ enabled, readOnly }: Props) {
  const [spaces, setSpaces] = useState<ServiceSpaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_SERVICE_SPACE_COLOR);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await listServiceSpaces({ includeInactive: true });
      if (res.success) setSpaces(res.data.spaces);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!enabled) return null;

  async function handleCreate() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await upsertServiceSpace({ name, color });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Espaço «${res.data.name}» criado.`);
      setName("");
      setColor(DEFAULT_SERVICE_SPACE_COLOR);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (readOnly) return;
    if (!window.confirm("Desactivar este espaço? Histórico de caixa/agenda permanece.")) return;
    const res = await deactivateServiceSpace({ id });
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Espaço desactivado.");
    await reload();
  }

  async function handleReactivate(s: ServiceSpaceRow) {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await upsertServiceSpace({
        id: s.id,
        name: s.name,
        color: s.color,
        active: true,
        sortOrder: s.sortOrder,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Espaço «${s.name}» reactivado.`);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border bg-white shadow-sm dark:bg-card">
      <CardHeader>
        <CardTitle>Espaços de Serviços</CardTitle>
        <CardDescription>
          Salas ou unidades (Pilates, Nutrição…) com catálogo e caixa próprios. Em Analisar,
          escolha «Todos» para ver consolidado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> A carregar…
          </p>
        ) : (
          <ul className="space-y-2">
            {spaces.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span
                  className="h-3 w-3 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-medium">{s.name}</span>
                {!s.active && (
                  <span className="text-xs text-muted-foreground">(inactivo)</span>
                )}
                {s.active && !readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 text-xs text-muted-foreground"
                    onClick={() => void handleDeactivate(s.id)}
                  >
                    Desactivar
                  </Button>
                )}
                {!s.active && !readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 text-xs text-clinical"
                    disabled={saving}
                    onClick={() => void handleReactivate(s)}
                  >
                    Reactivar
                  </Button>
                )}
              </li>
            ))}
            {spaces.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ainda não há espaços. Crie o primeiro abaixo.
              </p>
            )}
          </ul>
        )}

        {!readOnly && (
          <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
            <div>
              <Label htmlFor="space-name">Nome do espaço</Label>
              <Input
                id="space-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Sala de Pilates"
                maxLength={80}
              />
            </div>
            <div>
              <Label>Cor na agenda</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {SERVICE_SPACE_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-7 w-7 rounded-full ring-offset-2 transition"
                    style={{
                      backgroundColor: c,
                      outline: color === c ? `2px solid ${c}` : undefined,
                      outlineOffset: 2,
                    }}
                    aria-label={`Cor ${c}`}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
            <Button
              type="button"
              className={financeOutlineBtnClass}
              disabled={saving || name.trim().length < 2}
              onClick={() => void handleCreate()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Criar espaço
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
