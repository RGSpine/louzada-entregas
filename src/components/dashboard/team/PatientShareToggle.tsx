"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  getPatientSharingState,
  setPatientSharing,
} from "@/app/actions/intra-users";

/**
 * Toggle "Compartilhar paciente com a clínica". Visível apenas em contas de
 * equipe e para quem pode gerenciar (dono do paciente ou ADMIN).
 */
export function PatientShareToggle({ patientId }: { patientId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isShared, setIsShared] = useState(false);
  /** Bloqueia cliques concorrentes antes do re-render (setState é assíncrono). */
  const savingRef = useRef(false);
  /** Só aplica o resultado do request mais recente (evita race em cliques rápidos). */
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void getPatientSharingState(patientId).then((res) => {
      if (!alive) return;
      if (res.success && res.data) {
        setVisible(res.data.isTeamPlan && res.data.canManage);
        setIsShared(res.data.isShared);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [patientId]);

  async function toggle() {
    if (savingRef.current) return;
    savingRef.current = true;
    const prev = isShared;
    const next = !prev;
    const seq = ++requestSeqRef.current;
    setSaving(true);
    // Optimistic UI — revertido só se ESTE request ainda for o vigente e falhar.
    setIsShared(next);
    try {
      const res = await setPatientSharing(patientId, next);
      if (seq !== requestSeqRef.current) {
        // Obsoleto: não toast, não reverte (o request mais novo é dono do estado).
        return;
      }
      if (!res.success) {
        setIsShared(prev);
        toast.error(res.error);
        return;
      }
      toast.success(next ? "Paciente compartilhado com a clínica." : "Compartilhamento removido.");
    } catch {
      if (seq === requestSeqRef.current) {
        setIsShared(prev);
        toast.error("Não foi possível atualizar o compartilhamento.");
      }
    } finally {
      savingRef.current = false;
      if (seq === requestSeqRef.current) {
        setSaving(false);
      }
    }
  }

  if (loading || !visible) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">Compartilhar paciente com a clínica</p>
          <p className="text-xs text-muted-foreground">
            Quando ativo, toda a equipe pode ver e atender este paciente.
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isShared}
        disabled={saving}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          isShared ? "bg-primary" : "bg-muted-foreground/30"
        } disabled:opacity-60`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
            isShared ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
        {saving && (
          <Loader2 className="absolute -right-6 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
