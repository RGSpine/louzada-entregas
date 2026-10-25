"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Save, Trash2, AlertTriangle, KeyRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { TeamManagementSection } from "@/components/dashboard/team/TeamManagementSection";
import { PushNotificationsToggle } from "@/components/pwa/PushNotificationsToggle";
import { AccessSessionsPanel } from "@/components/dashboard/AccessSessionsPanel";
import { SecretField } from "@/components/dashboard/SecretField";
import { getMyProfile, updateMyProfile, deleteMyAccount, type ProfileData } from "@/app/actions/profile";
import { changeAccountPasswordAction } from "@/app/actions/auth";

const profileSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome."),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isPrincipalAdmin, setIsPrincipalAdmin] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const result = await getMyProfile();

        if (!result.success || !result.profile) {
          toast.error(result.error || "Erro ao carregar perfil");
          router.push("/dashboard");
          return;
        }

        setProfile(result.profile);
        setIsPrincipalAdmin(result.isPrincipalAdmin === true);
        setValue("name", result.profile.name || "");
      } catch (error) {
        console.error("Erro ao carregar perfil:", error);
        toast.error("Erro ao carregar perfil");
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [router, setValue]);

  const onSubmit = async (data: ProfileFormValues) => {
    try {
      const result = await updateMyProfile({ name: data.name });

      if (!result.success) {
        toast.error(result.error || "Erro ao salvar alterações");
        return;
      }

      toast.success("Nome atualizado.");
    } catch (error) {
      console.error("Erro ao salvar:", error);
      toast.error("Erro inesperado ao salvar");
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsChangingPassword(true);
    try {
      const result = await changeAccountPasswordAction({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      if (!result.success) {
        toast.error(result.error || "Erro ao atualizar senha");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Senha atualizada.");
    } catch (error) {
      console.error("Erro ao atualizar senha:", error);
      toast.error("Erro inesperado ao atualizar senha");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteMyAccount();

      if (!result.success) {
        toast.error(result.error || "Erro ao deletar conta");
        setIsDeleting(false);
        return;
      }

      setIsDeleted(true);
    } catch (error) {
      console.error("Erro ao deletar:", error);
      toast.error("Erro inesperado ao deletar conta");
      setIsDeleting(false);
    }
  };

  if (isDeleted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full bg-card border-border">
          <CardContent className="pt-8 pb-8 text-center space-y-6">
            <div className="text-6xl">😢</div>
            <h1 className="text-2xl font-bold text-foreground">
              Que pena que você está indo...
            </h1>
            <p className="text-muted-foreground">
              Mas te desejamos boa sorte na sua jornada!
            </p>
            <p className="text-muted-foreground">
              Caso queira voltar, será um prazer te receber novamente.
            </p>
            <Link href="/register">
              <Button className="w-full bg-primary hover:bg-primary/90 mt-4">
                Clique aqui para se cadastrar novamente
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Carregando perfil...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Meu Perfil</h1>
          <p className="text-muted-foreground">
            {isPrincipalAdmin
              ? "Notificações, dados da conta, equipe e dispositivos."
              : "Dispositivos conectados nesta conta."}
          </p>
        </div>

        {isPrincipalAdmin ? (
          <>
        <div className="mb-6">
          <PushNotificationsToggle />
        </div>

        <Card className="bg-card border-border mb-8">
          <CardHeader>
            <CardTitle className="text-foreground">Dados da conta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label className="text-foreground/90">E-mail</Label>
                <Input
                  type="email"
                  value={profile?.email || ""}
                  readOnly
                  className="bg-muted border-border text-muted-foreground cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground">O e-mail não pode ser alterado</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name" className="text-foreground/90">
                  Nome
                </Label>
                <Input
                  id="name"
                  type="text"
                  className="bg-card border-border text-foreground"
                  {...register("name")}
                />
                {errors.name ? (
                  <p className="text-xs text-destructive">{errors.name.message}</p>
                ) : null}
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || !isDirty}
                className="w-full bg-primary hover:bg-primary/90"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Salvar nome
                  </>
                )}
              </Button>
            </form>

            <form onSubmit={handleChangePassword} className="space-y-4 border-t border-border pt-6">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound className="h-4 w-4 text-primary" />
                Senha
              </p>
              <SecretField
                id="current-password"
                label="Senha atual"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <p className="text-xs text-muted-foreground">
                O campo abre visível. Se não lembrar a senha, deixe-o em branco e defina a nova.
              </p>
              <SecretField
                id="new-password"
                label="Nova senha"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
              />
              <SecretField
                id="confirm-password"
                label="Confirmar nova senha"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={isChangingPassword}
                className="w-full border-border"
              >
                {isChangingPassword ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Atualizando...
                  </>
                ) : (
                  "Alterar senha"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <TeamManagementSection />
          </>
        ) : null}

        <AccessSessionsPanel />

        <Card className="bg-card border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Deletar conta
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <h3 className="text-destructive font-semibold mb-2">
                  Você tem certeza que quer deletar?
                </h3>
                <p className="text-muted-foreground text-sm mb-3">
                  Esta ação apaga a conta do laboratório e não pode ser desfeita.
                </p>
                <ul className="text-muted-foreground text-sm space-y-1">
                  <li>• Comandos de coleta e entrega</li>
                  <li>• Agenda e clientes do laboratório</li>
                  <li>• Financeiro das próteses</li>
                </ul>
              </div>

              {showDeleteConfirm ? (
                <div className="flex gap-3">
                  <Button
                    onClick={() => setShowDeleteConfirm(false)}
                    variant="outline"
                    className="flex-1 border-border text-muted-foreground"
                  >
                    Voltar
                  </Button>
                  <Button
                    onClick={handleDeleteAccount}
                    disabled={isDeleting}
                    className="flex-1 bg-destructive hover:bg-destructive/90"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Deletando...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Sim, deletar
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => setShowDeleteConfirm(true)}
                  variant="outline"
                  className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Deletar minha conta
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
