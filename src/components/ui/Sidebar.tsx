"use client";

/**
 * Lista legada — o menu global do dashboard vive em `DashboardPagesMenu` e em
 * `src/lib/dashboard-nav-pages.ts`. Ao alterar rotas do dashboard, atualize esse ficheiro.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Users, History, Settings, MessageSquareText } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const menuItems = [
    {
      label: "Nova Evolução",
      href: "/dashboard/new-evolution",
      icon: FileText,
    },
    {
      label: "Meus Pacientes",
      href: "/dashboard/patients",
      icon: Users,
    },
    {
      label: "Histórico",
      href: "/dashboard/patients",
      icon: History,
    },
    {
      label: "Meu Perfil",
      href: "/dashboard/profile",
      icon: Settings,
    },
    {
      label: "Suporte",
      href: "/dashboard/suporte",
      icon: MessageSquareText,
    },
  ];

  return (
    <div className="flex h-screen w-64 flex-col border-r border-border bg-muted">
      <div className="border-b border-border p-6">
        <h1 className="text-2xl font-bold text-primary">Louzada Entregas</h1>
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex min-h-[2.75rem] items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                    isActive
                      ? "bg-primary font-medium text-primary-foreground"
                      : "text-foreground/90 hover:bg-muted"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
