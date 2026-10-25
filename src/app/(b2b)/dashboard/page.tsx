"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Loader2,
  LogOut,
  Mic,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { logoutAction } from "@/app/actions/auth";
import { DashboardHubStagger } from "@/components/dashboard/DashboardHubStagger";
import { TeamSetupNudge } from "@/components/dashboard/team/TeamSetupNudge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_HOME_TITLE } from "@/lib/dashboard-nav-pages";
import { releaseAccessSessionClient } from "@/lib/access-session-client";

const shortcuts = [
  {
    href: "/dashboard/painel",
    title: "Painel do Dia",
    description: "Grave o comando, revise o lote e dê baixa nas entregas.",
    icon: Mic,
  },
  {
    href: "/dashboard/dentistas",
    title: "Clientes",
    description: "Endereços para coleta e entrega, e o cadastro dos entregadores.",
    icon: Users,
  },
  {
    href: "/dashboard/agenda",
    title: "Agenda",
    description: "Coletas e entregas da semana, no dia e no horário ouvido.",
    icon: CalendarDays,
  },
  {
    href: "/dashboard/registros",
    title: "Registros",
    description: "Busca de coletas e entregas por dia, cliente e entregador.",
    icon: ClipboardList,
  },
  {
    href: "/dashboard/finances",
    title: "Financeiro",
    description: "Caixa, serviços de prótese e lançamentos de coleta e entrega.",
    icon: Wallet,
  },
  {
    href: "/dashboard/profile",
    title: "Equipe e perfil",
    description: "Dados da conta e criação de intra users.",
    icon: User,
  },
] as const;

export default function DashboardPage() {
  return <DashboardHome />;
}

function DashboardHome() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await releaseAccessSessionClient();
      const result = await logoutAction();
      if (result.success) {
        toast.success("Logout realizado com sucesso!");
        router.push("/login");
      } else {
        toast.error(result.error || "Erro ao fazer logout");
      }
    } catch {
      toast.error("Erro inesperado ao fazer logout");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="text-foreground">
      <div className="container mx-auto px-4 py-8">
        <div className="mx-auto w-full max-w-2xl lg:max-w-3xl xl:max-w-6xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {DASHBOARD_HOME_TITLE}
              </h1>
              <p className="mt-2 text-muted-foreground">
                Coletas, entregas e financeiro do laboratório.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
            >
              {isLoggingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden />
              )}
              Sair
            </Button>
          </div>

          <TeamSetupNudge />

          <DashboardHubStagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shortcuts.map((item) => (
              <Link key={item.href} href={item.href} className="block h-full">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <item.icon className="h-5 w-5 text-primary" aria-hidden />
                      {item.title}
                    </CardTitle>
                    <CardDescription>{item.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <span className="text-sm font-medium text-primary">Abrir</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </DashboardHubStagger>
        </div>
      </div>
    </div>
  );
}
