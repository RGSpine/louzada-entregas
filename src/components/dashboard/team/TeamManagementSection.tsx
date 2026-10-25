"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  UsersRound,
  Plus,
  Trash2,
  Check,
  Lock,
  KeyRound,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  listIntraUsers,
  createIntraUser,
  deleteIntraUser,
  updateIntraUser,
  switchActiveIntraUser,
  setAdminIntraUserPin,
  changeAdminIntraUserPin,
  getOwnerAdminPin,
  type TeamOverview,
  type IntraUserDTO,
} from "@/app/actions/intra-users";
import { DEFAULT_INTRA_USER_COLOR } from "@/lib/intra-user/constants";
import { SecretField } from "@/components/dashboard/SecretField";

export function TeamManagementSection() {
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(DEFAULT_INTRA_USER_COLOR);

  const [switchTarget, setSwitchTarget] = useState<IntraUserDTO | null>(null);
  const [switchPin, setSwitchPin] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");

  /** Primeira definição de PIN do ADMIN ativo (sem PIN antigo). */
  const [firstPin, setFirstPin] = useState("");
  const [firstPinConfirm, setFirstPinConfirm] = useState("");

  const [changeCurrent, setChangeCurrent] = useState("");
  const [changeNew, setChangeNew] = useState("");
  const [changeConfirm, setChangeConfirm] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const load = useCallback(async () => {
    const res = await listIntraUsers();
    if (!res.success) {
      toast.error(res.error);
      setOverview(null);
      return;
    }
    setOverview(res.data ?? null);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!overview?.canEditAdmin) return;
    let cancelled = false;
    void getOwnerAdminPin().then((res) => {
      if (cancelled || !res.success) return;
      const pin = res.data?.pin;
      if (pin) setChangeCurrent(pin);
    });
    return () => {
      cancelled = true;
    };
  }, [overview?.canEditAdmin]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim().length < 2) {
      toast.error("Informe o nome.");
      return;
    }
    setBusy(true);
    try {
      const res = await createIntraUser({
        name: newName.trim(),
        color: newColor,
        role: "MEMBER",
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Pessoa acrescentada à equipe.");
      setNewName("");
      setNewColor(DEFAULT_INTRA_USER_COLOR);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (
      !window.confirm(
        `Remover «${name}» da equipe?\n\nAs marcações já feitas continuam na conta.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await deleteIntraUser(id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Profissional removido.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitch(member: IntraUserDTO) {
    if (member.role === "ADMIN" && member.hasPin) {
      setSwitchTarget(member);
      setSwitchPin("");
      setSetupPin("");
      setSetupConfirm("");
      return;
    }
    setBusy(true);
    try {
      const res = await switchActiveIntraUser(member.id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Perfil ativo: ${res.data?.name ?? ""}.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmAdminSwitch(e: React.FormEvent) {
    e.preventDefault();
    if (!switchTarget) return;
    setBusy(true);
    try {
      if (!switchTarget.hasPin) {
        const res = await setAdminIntraUserPin({
          intraUserId: switchTarget.id,
          pin: setupPin,
          confirmPin: setupConfirm,
          activate: true,
        });
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success(`PIN definido. Perfil ativo: ${switchTarget.name}.`);
      } else {
        const res = await switchActiveIntraUser(switchTarget.id, switchPin);
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success(`Perfil ativo: ${res.data?.name ?? ""}.`);
      }
      setSwitchTarget(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await changeAdminIntraUserPin({
        currentPin: changeCurrent,
        newPin: changeNew,
        confirmPin: changeConfirm,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("PIN atualizado.");
      setChangeCurrent(changeNew);
      setChangeNew("");
      setChangeConfirm("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleFirstPinSetup(e: React.FormEvent) {
    e.preventDefault();
    const active = overview?.members.find((m) => m.isActive);
    if (!active || !active.isOwner) {
      toast.error("Entre como administrador para definir o PIN.");
      return;
    }
    setBusy(true);
    try {
      const res = await setAdminIntraUserPin({
        intraUserId: active.id,
        pin: firstPin,
        confirmPin: firstPinConfirm,
        activate: false,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("PIN definido com sucesso.");
      setFirstPin("");
      setFirstPinConfirm("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  function startRename(member: IntraUserDTO) {
    setEditingId(member.id);
    setEditingName(member.name);
  }

  function cancelRename() {
    setEditingId(null);
    setEditingName("");
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const name = editingName.trim();
    if (name.length < 2) {
      toast.error("Informe um nome com pelo menos 2 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const res = await updateIntraUser({ id: editingId, name });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Nome atualizado.");
      cancelRename();
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Recurso exclusivo dos planos de equipe (Consultório/Clínica).
  if (!loading && overview && !overview.isClinica) {
    return null;
  }

  const activeMember = overview?.members.find((m) => m.isActive) ?? null;
  const activeIsOwner = activeMember?.isOwner === true;
  const activeNeedsPinSetup = Boolean(activeMember?.isOwner && !activeMember.hasPin);

  return (
    <Card id="equipe-clinica" className="scroll-mt-24 bg-card border-border mb-8">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <UsersRound className="h-5 w-5 text-primary" />
          Equipe do laboratório
        </CardTitle>
        <CardDescription>
          Quem opera a conta vê as mesmas coletas, entregas, clientes e entregadores.
          A diferença entre as pessoas é o nome na marcação: Criada por quem estava operando.
          Só o administrador principal acrescenta ou remove alguém, e só ele altera o próprio PIN.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando equipe…
          </div>
        ) : !overview ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar a equipe.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">
                {overview.intraUserCount} de {overview.maxIntraUsers} usuários
              </Badge>
              {!overview.canManage && (
                <span className="text-xs">Escolha quem está operando para cadastrar alguém.</span>
              )}
            </div>

            <ul className="divide-y divide-border rounded-lg border border-border">
              {overview.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: m.color }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    {editingId === m.id ? (
                      <form onSubmit={saveRename} className="flex flex-wrap items-center gap-2">
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-8 max-w-xs bg-card border-border text-sm"
                          maxLength={80}
                          autoFocus
                          aria-label="Novo nome do profissional"
                        />
                        <Button type="submit" size="sm" disabled={busy}>
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={cancelRename}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </form>
                    ) : (
                      <>
                        <p className="truncate text-sm font-medium text-foreground">
                          {m.name}
                          {m.isActive && (
                            <span className="ml-2 text-xs font-normal text-primary">
                              (perfil ativo)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {m.isOwner ? "Administrador principal" : "Mesmo acesso"}
                          {m.isOwner ? " · só ele mesmo autoriza a alteração" : ""}
                          {m.isOwner && m.nameRevision >= 1 ? " · nome definido" : ""}
                          {m.isOwner && m.nameRevision < 1 ? " · o nome ainda pode ser ajustado uma vez" : ""}
                        </p>
                      </>
                    )}
                  </div>
                  {editingId !== m.id && (m.isOwner ? overview.canEditAdmin && m.nameRevision < 1 : overview.canManage) && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      disabled={busy}
                      onClick={() => startRename(m)}
                      aria-label={`Renomear ${m.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {!m.isActive && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-border"
                      disabled={busy}
                      onClick={() => handleSwitch(m)}
                    >
                      {m.role === "ADMIN" ? (
                        <Lock className="mr-1 h-3.5 w-3.5" />
                      ) : (
                        <Check className="mr-1 h-3.5 w-3.5" />
                      )}{" "}
                      Usar
                    </Button>
                  )}
                  {overview.canEditAdmin && !m.isOwner && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={busy}
                      onClick={() => handleDelete(m.id, m.name)}
                      aria-label={`Remover ${m.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {switchTarget && (
              <form
                onSubmit={confirmAdminSwitch}
                className="space-y-3 rounded-lg border border-border bg-muted/30 p-3"
              >
                <p className="text-sm font-medium text-foreground">
                  {switchTarget.hasPin
                    ? `PIN para usar «${switchTarget.name}»`
                    : `Definir PIN de «${switchTarget.name}»`}
                </p>
                {switchTarget.hasPin ? (
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={switchPin}
                    onChange={(e) => setSwitchPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="PIN"
                    className="bg-card border-border tracking-widest"
                    autoFocus
                  />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={setupPin}
                      onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="Novo PIN"
                      className="bg-card border-border tracking-widest"
                      autoFocus
                    />
                    <Input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={setupConfirm}
                      onChange={(e) =>
                        setSetupConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))
                      }
                      placeholder="Confirmar PIN"
                      className="bg-card border-border tracking-widest"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirmar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setSwitchTarget(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            )}

            {activeIsOwner && activeNeedsPinSetup && activeMember && (
              <form
                onSubmit={handleFirstPinSetup}
                className="space-y-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3"
              >
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Criar PIN do administrador
                </p>
                <p className="text-xs text-muted-foreground">
                  Este perfil ainda não tem PIN. Defina um código de 4 números para proteger o
                  acesso de administrador.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="first-pin" className="text-foreground/90">
                      Novo PIN
                    </Label>
                    <Input
                      id="first-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={firstPin}
                      onChange={(e) => setFirstPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="4 números"
                      className="bg-card border-border tracking-widest"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="first-pin-confirm" className="text-foreground/90">
                      Confirmar PIN
                    </Label>
                    <Input
                      id="first-pin-confirm"
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={firstPinConfirm}
                      onChange={(e) =>
                        setFirstPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))
                      }
                      placeholder="Repita o PIN"
                      className="bg-card border-border tracking-widest"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <Button type="submit" size="sm" disabled={busy || firstPin.length < 4}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Definir PIN
                </Button>
              </form>
            )}

            {activeIsOwner && !activeNeedsPinSetup && (
              <form
                onSubmit={handleChangePin}
                className="space-y-3 rounded-lg border border-dashed border-border p-3"
              >
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Alterar PIN do administrador ativo
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <SecretField
                    id="admin-pin-current"
                    label="PIN atual"
                    value={changeCurrent}
                    onChange={(value) => setChangeCurrent(value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="off"
                  />
                  <SecretField
                    id="admin-pin-new"
                    label="Novo PIN"
                    value={changeNew}
                    onChange={(value) => setChangeNew(value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="off"
                  />
                  <SecretField
                    id="admin-pin-confirm"
                    label="Confirmar PIN"
                    value={changeConfirm}
                    onChange={(value) => setChangeConfirm(value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" size="sm" variant="outline" disabled={busy}>
                  Atualizar PIN
                </Button>
              </form>
            )}

            {overview.canEditAdmin && overview.intraUserCount < overview.maxIntraUsers && (
              <form onSubmit={handleCreate} className="space-y-3 rounded-lg border border-dashed border-border p-3">
                <p className="text-sm font-medium text-foreground">Acrescentar pessoa</p>
                <div className="space-y-1.5">
                  <Label htmlFor="intra-name" className="text-foreground/90">
                    Nome
                  </Label>
                  <Input
                    id="intra-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex.: Mariana"
                    className="bg-card border-border"
                  />
                </div>
                <Button type="submit" disabled={busy} size="sm">
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Acrescentar
                </Button>
              </form>
            )}

            {overview.canEditAdmin && overview.intraUserCount >= overview.maxIntraUsers && (
              <p className="text-xs text-muted-foreground">
                A equipe já está com {overview.maxIntraUsers} pessoas, que é o máximo.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
