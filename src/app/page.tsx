import Link from "next/link";
import { CalendarDays, Mic, Users, Wallet } from "lucide-react";

import { LouzadaLogo } from "@/components/brand/LouzadaLogo";
import { Button } from "@/components/ui/button";

const entries = [
  { icon: Mic, label: "Comandos de coleta e entrega" },
  { icon: Users, label: "Clientes do laboratório" },
  { icon: CalendarDays, label: "Agenda" },
  { icon: Wallet, label: "Financeiro das próteses" },
];

export default function Home() {
  return (
    <main className="depth-stage min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
      <div className="grid w-full justify-center" style={{ gridTemplateColumns: "minmax(0, 20rem)" }}>
        <LouzadaLogo className="text-primary" />
      </div>
      <h1 className="mt-6 text-center text-4xl font-bold tracking-tight text-foreground">Louzada Entregas</h1>
      <p className="mx-auto mt-3 max-w-xl text-center text-base text-muted-foreground">
        Coletas e entregas de prótese, clientes do laboratório e financeiro.
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {entries.map((item) => (
          <li
            key={item.label}
            className="depth-card flex items-center gap-3 px-4 py-3 text-sm text-foreground"
          >
            <item.icon className="h-4 w-4 text-primary" aria-hidden />
            {item.label}
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild size="lg" className="h-12 w-full px-8 text-base sm:w-auto sm:min-w-44">
          <Link href="/login">Entrar</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-12 w-full px-8 text-base sm:w-auto sm:min-w-44">
          <Link href="/register">Criar conta</Link>
        </Button>
      </div>
      </div>
    </main>
  );
}
